import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SSEChunk,
  StrategyRequestDto,
  StrategyResponse,
  StrategySSEData,
  StrategyType,
} from '@xiaoyu/api-types';
import { ParallelLLMService } from '../../llm/services/parallel-llm.service';
import { JudgeService } from '../../llm/services/judge.service';
import { LLMMessage } from '../../llm/interfaces/llm-provider.interface';
import { FeatureFlags } from '../../llm/config/features';
import { AnalysisRequest, AnalysisTemplateType } from '../../../entities/analysis-request.entity';
import { AnalysisResult } from '../../../entities/analysis-result.entity';
import { AnalysisTemplate } from '../templates/analysis-template';
import { SwotTemplate } from '../templates/swot.template';
import { DecisionTreeTemplate } from '../templates/decision-tree.template';
import { ProsConsTemplate } from '../templates/pros-cons.template';

const PARALLEL_PROVIDER_POOL: ReadonlyArray<string> = ['kimi', 'deepseek', 'glm'];

/**
 * Total wall-clock budget for the analysis stream (parallel fan-out
 * + judge + DB writes). 90s mirrors the requirement: anything
 * longer and the client should have already given up.
 */
const ANALYSIS_TIMEOUT_MS = 90_000;

/**
 * Default fallback returned to the client when every provider in
 * the parallel ensemble fails. Keeping it in one place lets us
 * tweak the user-facing copy without hunting through the service.
 */
const FALLBACK_MESSAGE =
  '当前所有模型均不可用，请稍后重试。' as const;

/**
 * Splits `text` into roughly `chunkSize`-character pieces without
 * breaking in the middle of a multibyte UTF-16 code unit. The
 * client is expected to reassemble these into the final answer.
 */
function splitText(text: string, chunkSize: number): string[] {
  if (!text) return [];
  if (chunkSize <= 0) return [text];
  const out: string[] = [];
  // The string is iterated as code points (not UTF-16 code units) so
  // surrogate pairs (e.g. emoji) are never split in half.
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += chunkSize) {
    out.push(chars.slice(i, i + chunkSize).join(''));
  }
  return out;
}

/**
 * AnalysisService is the U7 orchestrator.
 *
 * Responsibilities:
 *   1. Hold the registry of `AnalysisTemplate`s and expose it.
 *   2. Persist a new `AnalysisRequest` row per invocation.
 *   3. Fan out a prompt to multiple LLM providers in parallel.
 *   4. Run the Judge to pick the best candidate.
 *   5. Stream the final answer back to the client as SSE events.
 *   6. Persist the final `AnalysisResult` row with provenance.
 *
 * Streaming model:
 *   The HTTP handler is an async generator. Each `yield` emits a
 *   single `StrategySSEData` envelope. The controller layer is
 *   responsible for the actual SSE framing.
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly templates: Record<StrategyType, AnalysisTemplate>;

  constructor(
    private readonly parallelLLMService: ParallelLLMService,
    private readonly judgeService: JudgeService,
    @InjectRepository(AnalysisRequest)
    private readonly requestRepository: Repository<AnalysisRequest>,
    @InjectRepository(AnalysisResult)
    private readonly resultRepository: Repository<AnalysisResult>,
  ) {
    this.templates = {
      swot: SwotTemplate,
      decision_tree: DecisionTreeTemplate,
      pros_cons: ProsConsTemplate,
    } as Record<StrategyType, AnalysisTemplate>;
  }

  /**
   * Returns the registered templates in a stable order so the
   * client UI can render them deterministically.
   */
  listTemplates(): AnalysisTemplate[] {
    return [
      this.templates.swot,
      this.templates.decision_tree,
      this.templates.pros_cons,
    ];
  }

  /**
   * Run an end-to-end analysis and stream the result back as SSE
   * events. The first event is always a `message_start`; the last
   * event is always a `message_end` (success) or `error` (failure).
   *
   * @param userId Authenticated user id (from `req.user.id`).
   * @param dto    Strategy request DTO validated by Zod.
   */
  async *createStream(
    userId: string,
    dto: StrategyRequestDto,
  ): AsyncIterable<SSEChunk<StrategySSEData>> {
    const template = this.templates[dto.type];
    if (!template) {
      // Defence in depth: Zod validation already enforces the
      // enum, but a programmatic call could still bypass it.
      throw new BadRequestException(`Unknown strategy type: ${String(dto.type)}`);
    }

    // Build the prompt from the raw query + optional context. The
    // template's `buildPrompt` is responsible for the actual
    // shape; here we just merge the two fields into a single
    // input map.
    const input: Record<string, unknown> = {
      topic: dto.query,
      context: dto.context ?? '',
    };
    const prompt = template.buildPrompt(input);

    // Persist the request first so the row exists even if the
    // pipeline errors out halfway. `templateType` is stored as the
    // string enum value to match the DB column constraint.
    const request = await this.requestRepository.save(
      this.requestRepository.create({
        templateType: dto.type as AnalysisTemplateType,
        input,
        userId,
      }),
    );

    yield* this.generateResponse(template, prompt, request.id);
  }

  /**
   * Internal generator: runs the parallel fan-out + judge + parse
   * pipeline and yields the SSE envelope for every step. Splitting
   * this out of `createStream` keeps the persistence and the
   * pipeline logic in their own cohesive units.
   */
  private async *generateResponse(
    template: AnalysisTemplate,
    prompt: string,
    requestId: string,
  ): AsyncIterable<SSEChunk<StrategySSEData>> {
    yield {
      event: 'message_start',
      data: { requestId, type: template.id },
    };

    let parsed: StrategyResponse | null = null;
    let modelUsed = 'multi';
    let providerOutputs: Record<string, string> = {};
    let judgeWinner: string | null = null;

    try {
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你是幕僚谋士。请按指定 JSON 格式输出分析结果，且只输出 JSON。',
        },
        { role: 'user', content: prompt },
      ];

      const providerNames = PARALLEL_PROVIDER_POOL.slice(
        0,
        FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS,
      );

      const { results, errors } = await this.parallelLLMService.chatParallel(
        { messages },
        providerNames as string[],
        // The parallel call is bounded by `parallelLLMService`'s
        // own per-provider timeout (default 30s). We pass the
        // analysis budget here so a single slow provider cannot
        // consume the whole 90s window on its own.
        ANALYSIS_TIMEOUT_MS,
      );

      // Record per-provider errors at warn level for observability
      // without surfacing them to the client.
      if (errors.length > 0) {
        this.logger.warn(
          `Analysis ${requestId}: ${errors.length} provider(s) failed: ${errors
            .map((e) => `${e.provider}:${e.code}`)
            .join(', ')}`,
        );
      }

      if (results.length === 0) {
        yield this.allProvidersFailedEvent(requestId);
        return;
      }

      // Capture raw provider outputs for the audit trail.
      providerOutputs = Object.fromEntries(
        results.map((r) => [r.provider, r.content ?? '']),
      );

      const judgeResult = await this.judgeService.judge({
        topic: prompt,
        candidates: results.map((r) => ({
          name: r.provider,
          output: r.content,
        })),
      });
      // eslint-disable-next-line no-console
      console.log('JUDGE_DEBUG', JSON.stringify({ winner: judgeResult.winner, content: judgeResult.content, modelUsed: judgeResult.modelUsed }));

      judgeWinner = judgeResult.winner;
      // `JudgeService` always returns a `content` string; when the
      // Judge is disabled or only one candidate exists the winner
      // is `null` and the content is the first candidate verbatim.
      const finalContent = judgeResult.content ?? '';
      modelUsed = `judge:${judgeResult.modelUsed || 'fallback'}`;
      parsed = template.parseOutput(finalContent);

      // Stream the analysed text in small chunks so the client
      // can render progressively.
      for (const chunk of splitText(parsed.analysis, 8)) {
        yield {
          event: 'message_delta',
          data: { requestId, content: chunk },
        };
      }

      yield {
        event: 'message_end',
        data: {
          requestId,
          type: parsed.type,
          analysis: parsed.analysis,
          structured: parsed.structured,
          modelUsed,
        },
      };

      // Persist the final result. We do this after the `message_end`
      // so the user-visible stream is not blocked on a DB write.
      // Failures here are logged but not surfaced — the answer has
      // already been delivered.
      try {
        await this.resultRepository.save(
          this.resultRepository.create({
            requestId,
            content: parsed.analysis,
            providerOutputs: {
              ...providerOutputs,
              ...(judgeResult.providerOutputs ?? {}),
              judgeWinner,
              judgeAnalysis: judgeResult.analysis ?? null,
            },
            judgeModel: judgeResult.modelUsed || 'fallback',
          }),
        );
      } catch (err) {
        this.logger.error(
          `Failed to persist AnalysisResult for ${requestId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } catch (err) {
      // Anything we did not anticipate — log the stack and yield
      // a generic error event so the client can show a fallback
      // message.
      this.logger.error(
        `Analysis ${requestId} failed: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );
      yield this.unexpectedErrorEvent(requestId);
      // `parsed` stays null here; the controller does not need it.
      void parsed;
    }
  }

  private allProvidersFailedEvent(requestId: string): SSEChunk<StrategySSEData> {
    return {
      event: 'error',
      data: {
        requestId,
        error: {
          code: 'ALL_PROVIDERS_FAILED',
          message: FALLBACK_MESSAGE,
        },
      },
    };
  }

  private unexpectedErrorEvent(requestId: string): SSEChunk<StrategySSEData> {
    return {
      event: 'error',
      data: {
        requestId,
        error: {
          code: 'ANALYSIS_ERROR',
          message: '分析失败，请重试',
        },
      },
    };
  }
}
