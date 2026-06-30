import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LLMError, LLMMessage } from '../../llm/interfaces/llm-provider.interface';
import {
  DEFAULT_PARALLEL_TIMEOUT_MS,
  FeatureFlags,
  MAX_PARALLEL_TIMEOUT_MS,
} from '../../llm/config/features';
import { JudgeService } from '../../llm/services/judge.service';
import { LLMProviderRegistry } from '../../llm/services/provider.registry';
import { ParallelLLMService } from '../../llm/services/parallel-llm.service';
import {
  RoutingDecision,
  RoutingService,
} from '../../llm/services/routing.service';
import { MessageRole } from '../../../entities/message.entity';
import { ChatSSEData, SSEChunk } from '@xiaoyu/api-types';
import { ContextService, LLMMessage as ContextLLMMessage } from './context.service';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';

/**
 * Result of a stream-creation call. `stream` is the async iterable
 * the controller iterates to write SSE frames. `messageId` is the
 * client-visible id shared by every frame in the same turn — the
 * client uses it to stitch deltas back together.
 */
export interface CreateStreamResult {
  stream: AsyncIterable<SSEChunk<ChatSSEData>>;
  messageId: string;
}

/**
 * Options for {@link ChatService.createStream}. `signal` lets the
 * controller abort the in-flight generation when the HTTP client
 * disconnects.
 */
export interface CreateStreamOptions {
  signal?: AbortSignal;
}

/**
 * Default chunk size (in characters) used when we have to fake a
 * stream from a non-streaming Judge result. Eight characters is
 * short enough to feel "live" but long enough that the wire format
 * is not dominated by per-frame overhead.
 */
const FALLBACK_STREAM_CHUNK_SIZE = 8;

/**
 * ChatService is the orchestrator for a single chat turn (U6).
 *
 * Pipeline:
 *   1. Locate or create the conversation (user-scoped).
 *   2. Persist the user message.
 *   3. Build the LLM context (recent turns) and prepend the system
 *      prompt.
 *   4. Ask RoutingService which path to use.
 *      - SIMPLE: stream from a single provider (Kimi).
 *      - COMPLEX: fan out to N providers in parallel, then ask the
 *        Judge LLM to pick a winner. The winner's content is
 *        sliced into chunks and yielded as a synthetic stream.
 *   5. Persist the assistant message.
 *   6. Emit a terminal `message_end` or `error` frame.
 *
 * The service never throws into the stream — every error becomes an
 * `error` SSE frame so the controller can finalize the response
 * cleanly. The only synchronous exceptions are validation errors
 * that the controller needs to surface as a 4xx status (e.g. an
 * unknown conversation id).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /**
   * Per-provider timeout (ms) for the parallel fan-out in the
   * COMPLEX path. The hard ceiling is enforced by
   * {@link MAX_PARALLEL_TIMEOUT_MS} so a misconfigured env var
   * cannot accidentally request a 10-minute wait.
   */
  private static readonly PARALLEL_TIMEOUT_MS = Math.min(
    DEFAULT_PARALLEL_TIMEOUT_MS,
    MAX_PARALLEL_TIMEOUT_MS,
  );

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly contextService: ContextService,
    private readonly routingService: RoutingService,
    private readonly parallelLLMService: ParallelLLMService,
    private readonly judgeService: JudgeService,
    private readonly registry: LLMProviderRegistry,
  ) {}

  /**
   * Top-level entry point used by the controller. Returns a
   * pre-built async iterable; the controller just iterates and
   * writes frames.
   *
   * @param userId          The owner of the conversation.
   * @param conversationId  Existing conversation id, or
   *                        `undefined` to create a new one. The
   *                        controller normalises the special token
   *                        `'new'` to `undefined` before calling.
   * @param content         The user message text. Already
   *                        validated against SendMessageSchema by
   *                        the controller, but we still apply the
   *                        hard cap here as a defence in depth.
   * @param options         Optional { signal }.
   */
  async createStream(
    userId: string,
    conversationId: string | undefined,
    content: string,
    options: CreateStreamOptions = {},
  ): Promise<CreateStreamResult> {
    if (!userId) {
      throw new NotFoundException('User is required');
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new NotFoundException('Message content must not be empty');
    }

    // 1. Locate or create the conversation.
    const conversation = conversationId
      ? await this.conversationService.findByIdAndUser(conversationId, userId)
      : await this.conversationService.create(userId);
    if (!conversation) {
      // findByIdAndUser returns null for missing OR cross-user ids
      // to avoid leaking existence; surface the same NotFound.
      throw new NotFoundException('Conversation not found');
    }

    // 2. Persist the user message. We always write the user turn
    // before opening the stream so the client can safely reload
    // the page after a dropped connection and see their message
    // already in the log.
    await this.messageService.create(
      conversation.id,
      userId,
      MessageRole.User,
      content,
    );

    // 3. Build the LLM context and prepend the system prompt.
    const context = await this.contextService.buildContext(
      conversation.id,
      userId,
      20,
    );
    // The user turn is the last item in `context` (it was just
    // persisted), but the routing decision needs a turn count that
    // excludes the current turn — that's what the spec means by
    // "turns already in the session".
    const userTurnCount = context.filter((m) => m.role === 'user').length;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是幕僚，一位得力助手。请用中文简洁回答。',
      },
      ...this.toProviderMessages(context),
      // The current user message is already in `context` (it was
      // written to the DB and re-read above). Re-appending it here
      // would duplicate the turn, so we deliberately do NOT.
    ];

    // 4. Routing decision.
    const decision = this.routingService.decide(content, Math.max(0, userTurnCount - 1));

    // 5. Build the streaming generator.
    const messageId = randomUUID();
    const stream = this.generateResponse(
      decision,
      messages,
      conversation.id,
      userId,
      messageId,
      content,
      options.signal,
    );

    return { stream, messageId };
  }

  /**
   * The actual async generator. Yields `ChatSSEData` frames in
   * the order required by the api-types contract:
   *   message_start → (message_delta)* → (message_end | error)
   *
   * The controller iterates this generator and serialises each
   * frame to the SSE wire format.
   */
  private async *generateResponse(
    decision: RoutingDecision,
    messages: LLMMessage[],
    conversationId: string,
    userId: string,
    messageId: string,
    userContent: string,
    signal: AbortSignal | undefined,
  ): AsyncIterable<SSEChunk<ChatSSEData>> {
    yield {
      event: 'message_start',
      data: { messageId, role: 'assistant' },
    };

    let fullContent = '';
    let modelUsed = '';
    let errorPayload: { code: string; message: string } | undefined;

    try {
      if (signal?.aborted) {
        throw new LLMErrorAbort();
      }

      if (decision === RoutingDecision.SIMPLE) {
        const provider = this.registry.get('kimi');
        modelUsed = provider.name;
        for await (const chunk of provider.chatStream({
          messages,
          options: { signal },
        })) {
          if (signal?.aborted) {
            throw new LLMErrorAbort();
          }
          const piece = chunk?.content ?? '';
          if (piece.length === 0) continue;
          fullContent += piece;
          yield {
            event: 'message_delta',
            data: { messageId, content: piece },
          };
        }
      } else {
        // COMPLEX path: parallel fan-out + Judge.
        const providerNames = this.selectProviders();
        if (providerNames.length === 0) {
          // Feature flag is set to 0 (or otherwise empty) — degrade
          // to SIMPLE so the user still gets a response.
          const provider = this.registry.get('kimi');
          modelUsed = provider.name;
          for await (const chunk of provider.chatStream({
            messages,
            options: { signal },
          })) {
            if (signal?.aborted) {
              throw new LLMErrorAbort();
            }
            const piece = chunk?.content ?? '';
            if (piece.length === 0) continue;
            fullContent += piece;
            yield {
              event: 'message_delta',
              data: { messageId, content: piece },
            };
          }
        } else {
          const { results, errors } = await this.parallelLLMService.chatParallel(
            { messages },
            providerNames,
            ChatService.PARALLEL_TIMEOUT_MS,
          );

          if (signal?.aborted) {
            throw new LLMErrorAbort();
          }

          if (results.length === 0) {
            this.logger.warn(
              `Complex path: all providers failed (${errors.length}). ` +
                `Falling back to single-model response.`,
            );
            errorPayload = {
              code: 'ALL_PROVIDERS_FAILED',
              message: '所有模型暂时不可用，请重试',
            };
          } else {
            const judgeInput = {
              topic: userContent,
              candidates: results.map((r) => ({
                name: r.provider ?? '',
                output: r.content,
              })),
            };
            const judgeResult = await this.judgeService.judge(judgeInput);

            if (signal?.aborted) {
              throw new LLMErrorAbort();
            }

            fullContent = judgeResult.content;
            modelUsed = judgeResult.modelUsed
              ? `judge:${judgeResult.modelUsed}`
              : 'judge';

            // Judge returns a complete string; slice it into small
            // chunks so the client experiences a real stream. The
            // architect explicitly approved this approach.
            const chunks = splitText(fullContent, FALLBACK_STREAM_CHUNK_SIZE);
            for (const piece of chunks) {
              if (signal?.aborted) {
                throw new LLMErrorAbort();
              }
              yield {
                event: 'message_delta',
                data: { messageId, content: piece },
              };
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof LLMErrorAbort) {
        // Client disconnected or 90s timeout fired. Do NOT surface
        // this as an error frame — the controller has already
        // closed the response. Just stop yielding.
        return;
      }
      const code =
        err instanceof LLMError ? err.code : 'UNKNOWN';
      const message =
        err instanceof Error && err.message
          ? err.message
          : '模型响应异常，请稍后重试';
      this.logger.error(
        `Chat generation failed (code=${code}): ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      errorPayload = {
        code,
        message: '模型响应异常，请稍后重试',
      };
      // Keep the underlying message for debugging; not exposed on
      // the wire because `message` is replaced with the user-facing
      // copy above.
      void message;
    }

    // Persist the assistant turn. We do this even after a partial
    // error so the user can see what was generated before the
    // failure.
    if (fullContent.length > 0) {
      try {
        await this.messageService.create(
          conversationId,
          userId,
          MessageRole.Assistant,
          fullContent,
        );
      } catch (persistErr) {
        // Persistence failure is logged but does not abort the
        // stream — the client still gets its response.
        this.logger.error(
          'Failed to persist assistant message',
          persistErr instanceof Error ? persistErr.stack : undefined,
        );
      }
    }

    if (errorPayload) {
      yield { event: 'error', data: { messageId, error: errorPayload } };
      return;
    }

    yield {
      event: 'message_end',
      data: { messageId, content: fullContent, modelUsed },
    };
  }

  /**
   * Select the providers that participate in the parallel
   * fan-out. The list is capped by
   * `FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS` and we always
   * return at least the first provider so the COMPLEX path is
   * never empty.
   */
  private selectProviders(): string[] {
    const all = ['kimi', 'deepseek', 'glm'];
    const count = Math.max(1, Math.min(3, FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS));
    return all.slice(0, count);
  }

  /**
   * Re-type the chat-domain LLMMessage onto the LLM provider
   * interface's LLMMessage. Both are structurally identical, but
   * keeping an explicit conversion makes the boundary clear and
   * means a future shape change in either side will surface as a
   * compile error rather than a silent cast.
   */
  private toProviderMessages(messages: ContextLLMMessage[]): LLMMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
}

/**
 * Internal sentinel used to break out of the generator when the
 * caller's AbortSignal has fired. We don't reuse LLMError here
 * because abort is not really an "error" — it's a coordinated
 * cancellation — and we want the persistence step skipped.
 */
class LLMErrorAbort extends Error {
  constructor() {
    super('aborted');
    this.name = 'LLMErrorAbort';
  }
}

/**
 * Slice `text` into fixed-size chunks for the synthetic stream
 * used in the COMPLEX path. Whitespace is preserved exactly so
 * the re-assembled text equals the original byte-for-byte.
 */
export function splitText(text: string, size: number): string[] {
  if (!text) return [];
  const safeSize = Math.max(1, Math.floor(size) || 1);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += safeSize) {
    out.push(text.slice(i, i + safeSize));
  }
  return out;
}
