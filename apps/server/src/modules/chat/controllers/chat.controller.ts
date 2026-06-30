import {
  Body,
  Controller,
  Header,
  HttpException,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ChatSSEData,
  CONVERSATIONS_ENDPOINT,
  SendMessageDto,
  SendMessageSchema,
  SSEChunk,
} from '@xiaoyu/api-types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { User } from '../../../entities/user.entity';
import {
  DeviceIdAuthGuard,
  RequestWithUser,
} from '../../auth/guards/device-id.guard';
import { ChatService } from '../services/chat.service';

/**
 * ChatController exposes the streaming chat surface for U6.
 *
 * The path mirrors the `MESSAGES_ENDPOINT` constant from
 * `@xiaoyu/api-types`. The global `/api/v1` prefix is stripped
 * from the constant so `main.ts` can re-add it via
 * `setGlobalPrefix` (NestJS `@Controller` does not accept a
 * function argument).
 */
const CHAT_CONTROLLER_PATH = `${CONVERSATIONS_ENDPOINT.replace(
  /^\/api\/v\d+\//,
  '',
)}/:conversationId/messages`;

/**
 * Sentinel path segment that means "create a new conversation".
 * Letting clients POST to a real uuid and to `'new'` removes the
 * need for a separate "create conversation, then send first
 * message" round-trip on the client.
 */
export const NEW_CONVERSATION_TOKEN = 'new';

/**
 * Total request timeout (ms). Includes time spent in
 * parallel fan-out + Judge; each individual provider call has its
 * own (smaller) per-call timeout enforced inside ParallelLLMService
 * and JudgeService.
 */
const TOTAL_REQUEST_TIMEOUT_MS = 90_000;

/**
 * ChatController is the single HTTP entry point for streaming chat
 * turns. The endpoint accepts a normal JSON body, but the response
 * is `text/event-stream`: the controller writes one SSE frame per
 * ChatSSEData event yielded by ChatService.
 *
 * Cleanup model:
 *   - An AbortController is created per request.
 *   - `res.on('close')` and `res.on('error')` abort it so the
 *     underlying provider stream can short-circuit on client
 *     disconnect.
 *   - A hard 90s timer also aborts it, so a runaway LLM call
 *     cannot keep the response open forever.
 *   - The listeners are removed in `finally` to prevent leaks
 *     across multiple connections.
 */
@Controller(CHAT_CONTROLLER_PATH)
@UseGuards(DeviceIdAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  /**
   * Open an SSE stream for a single chat turn. The response body
   * is built incrementally by `res.write`; `res.end()` finalises
   * the connection.
   *
   * The `conversationId` URL param accepts either a real UUID or
   * the literal `'new'` to spawn a fresh conversation. Anything
   * else that is not a UUID is rejected with 400 before the
   * service is called.
   */
  @Post('stream')
  @UsePipes(new ZodValidationPipe(SendMessageSchema))
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async stream(
    @Req() request: RequestWithUser,
    @Param('conversationId') conversationIdRaw: string,
    @Body() body: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const user = this.requireUser(request);

    // We do NOT use ParseUUIDPipe on :conversationId because we
    // also accept the 'new' sentinel. Resolve it here.
    const conversationId = this.resolveConversationId(conversationIdRaw);
    if (conversationId === null) {
      response.status(400).json({
        code: 'INVALID_CONVERSATION_ID',
        message: 'conversationId must be a UUID or the literal "new"',
      });
      return;
    }

    const abortController = new AbortController();
    const totalTimer = setTimeout(() => {
      abortController.abort();
    }, TOTAL_REQUEST_TIMEOUT_MS);
    // Do not keep the event loop alive on shutdown.
    if (typeof (totalTimer as { unref?: () => void }).unref === 'function') {
      (totalTimer as { unref: () => void }).unref();
    }

    const onClose = () => abortController.abort();
    response.on('close', onClose);
    response.on('error', onClose);

    try {
      const { stream, messageId } = await this.chatService.createStream(
        user.id,
        conversationId ?? undefined,
        body.content,
        { signal: abortController.signal },
      );

      // Flush headers so the client sees the SSE Content-Type
      // immediately. Some proxies buffer until first byte
      // otherwise.
      if (typeof response.flushHeaders === 'function') {
        response.flushHeaders();
      }

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          break;
        }
        response.write(this.formatSseFrame(event));
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        // Client disconnected or total timeout fired. Nothing to
        // write — the connection is already gone or closing.
        return;
      }
      if (response.writableEnded) {
        return;
      }
      this.logger.error(
        `Chat stream failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const message = err instanceof Error ? err.message : '流式输出失败';
      response.status(status).json({
        code: 'STREAM_ERROR',
        message,
      });
    } finally {
      clearTimeout(totalTimer);
      response.removeListener('close', onClose);
      response.removeListener('error', onClose);
      if (!response.writableEnded) {
        response.end();
      }
    }
  }

  /**
   * Resolve the URL param into a real conversation id, the
   * 'new' sentinel, or null (invalid).
   */
  private resolveConversationId(raw: string): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed === NEW_CONVERSATION_TOKEN) return null; // null means "create new"
    // Lightweight UUID shape check. We deliberately do not
    // require version 4: existing rows were created with v4, but
    // being strict here would break future format changes.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      )
    ) {
      return null;
    }
    return trimmed;
  }

  /**
   * Serialise a ChatSSEData into a wire-format SSE frame. We
   * intentionally keep the line format minimal (no `id:` /
   * `retry:` fields) — clients should rely on the `event:` line
   * for dispatching, which is what the api-types contract
   * specifies.
   */
  private formatSseFrame(event: SSEChunk<ChatSSEData>): string {
    // The discriminator lives on `event`; the data payload is
    // every other field. We shape this so that the JSON line
    // matches the api-types `ChatSSEData` exactly.
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data ?? {})}\n\n`;
  }

  private requireUser(request: RequestWithUser): User {
    if (!request.user) {
      throw new Error('DeviceIdAuthGuard did not populate req.user');
    }
    return request.user;
  }
}
