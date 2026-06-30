import { Injectable } from '@nestjs/common';
import {
  ChatCompletionParams,
  ChatCompletionResult,
  LLMError,
  LLMErrorCode,
  LLMProvider,
} from '../interfaces/llm-provider.interface';
import {
  DEFAULT_PARALLEL_TIMEOUT_MS,
  FeatureFlags,
  MAX_PARALLEL_MODELS,
} from '../config/features';
import { LLMProviderRegistry } from './provider.registry';

export interface ParallelChatResult {
  /**
   * Successful results, each tagged with the provider that
   * produced it. The `provider` field is the same string the
   * caller passed in `providerNames` (e.g. "kimi"), so the
   * orchestrator can pass it to downstream stages (Judge) without
   * doing a name lookup. We attach it here because
   * `ChatCompletionResult` is intentionally provider-agnostic.
   */
  results: Array<ChatCompletionResult & { provider: string }>;
  errors: LLMError[];
}

/**
 * ParallelLLMService fans out a single chat request to multiple
 * providers in parallel and collects both successes and failures.
 *
 * Design rules:
 *   - No provider can block the others: we use Promise.allSettled.
 *   - Each provider has its own timeout. A timeout is converted into
 *     an LLMError(LLMErrorCode.TIMEOUT, providerName, …, retryable=true).
 *   - Non-LLMError rejections are wrapped so the caller never has to
 *     handle a raw Error — every failure path returns a typed LLMError.
 *   - We never silently use a "wrong" model: if a provider name is
 *     unknown, the registry throws LLMError(UNKNOWN) synchronously
 *     *before* we even start the parallel fan-out, so the call
 *     collapses into a single error result.
 */
@Injectable()
export class ParallelLLMService {
  constructor(private readonly registry: LLMProviderRegistry) {}

  /**
   * Run `chat` against every provider in `providerNames` in parallel
   * and wait for all of them (or for the timeout on each).
   *
   * @param params        The chat params to send to every provider.
   * @param providerNames Ordered list of provider names. Capped to
   *                      `FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS`
   *                      (hard ceiling 3). Extra names are dropped
   *                      silently to keep the contract forgiving.
   * @param timeoutMs     Per-provider timeout, default 30s.
   */
  async chatParallel(
    params: ChatCompletionParams,
    providerNames: string[],
    timeoutMs: number = DEFAULT_PARALLEL_TIMEOUT_MS,
  ): Promise<ParallelChatResult> {
    const names = this.clampProviderNames(providerNames);

    let providers: LLMProvider[];
    try {
      providers = this.registry.getAll(names);
    } catch (err) {
      // Registry errors (e.g. unknown provider name) are surfaced as
      // a single error result so the caller can fall back to the
      // simple path. We do not throw — that would defeat the whole
      // purpose of having a degradation contract.
      const error =
        err instanceof LLMError
          ? err
          : new LLMError(
              LLMErrorCode.UNKNOWN,
              'registry',
              err instanceof Error ? err.message : String(err),
              true,
            );
      return { results: [], errors: [error] };
    }

    if (providers.length === 0) {
      return { results: [], errors: [] };
    }

    const settled = await Promise.allSettled(
      providers.map((p) => this.callWithTimeout(p, params, timeoutMs)),
    );

    const results: Array<ChatCompletionResult & { provider: string }> = [];
    const errors: LLMError[] = [];

    settled.forEach((r, idx) => {
      const providerName = providers[idx].name;
      if (r.status === 'fulfilled') {
        // Attach the provider name so callers (e.g. the Judge
        // stage) can map a result back to a provider without a
        // separate name table.
        results.push({ ...r.value, provider: providerName });
        return;
      }
      const reason = r.reason;
      if (reason instanceof LLMError) {
        errors.push(reason);
        return;
      }
      errors.push(
        new LLMError(
          LLMErrorCode.UNKNOWN,
          providerName,
          reason instanceof Error ? reason.message : String(reason),
          true,
        ),
      );
    });

    return { results, errors };
  }

  /**
   * Cap the requested provider list to the configured maximum. We do
   * this *before* hitting the registry so the caller cannot accidentally
   * fan out to 10 models just by passing 10 names.
   */
  private clampProviderNames(providerNames: string[]): string[] {
    if (!Array.isArray(providerNames) || providerNames.length === 0) {
      return [];
    }
    const max = Math.min(
      FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS,
      MAX_PARALLEL_MODELS,
    );
    return providerNames.slice(0, max);
  }

  /**
   * Race a `provider.chat` call against a timer. The timer is always
   * cleared, even on resolution, to keep the Node event loop clean.
   */
  private callWithTimeout(
    provider: LLMProvider,
    params: ChatCompletionParams,
    timeoutMs: number,
  ): Promise<ChatCompletionResult> {
    return new Promise<ChatCompletionResult>((resolve, reject) => {
      const safeTimeout = Math.max(1, timeoutMs);
      const timer = setTimeout(() => {
        reject(
          new LLMError(
            LLMErrorCode.TIMEOUT,
            provider.name,
            `Provider ${provider.name} timed out after ${safeTimeout}ms`,
            true,
          ),
        );
      }, safeTimeout);

      // Unref the timer so an in-flight timeout does not keep the
      // process alive on shutdown.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }

      provider
        .chat(params)
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
