import { Injectable, Logger } from '@nestjs/common';
import {
  ChatCompletionParams,
  ChatCompletionResult,
  LLMError,
  LLMErrorCode,
  LLMProvider,
} from '../interfaces/llm-provider.interface';
import {
  DEFAULT_JUDGE_TIMEOUT_MS,
  FeatureFlags,
} from '../config/features';
import { LLMProviderRegistry } from './provider.registry';
import {
  buildJudgePromptMulti,
  MultiJudgeCandidate,
} from '../prompts/judge/judge.prompt';
import { renderEvaluationDimensionsLine } from '../prompts/judge/evaluation-dimensions';

export interface JudgeCandidateInput {
  /** Provider name (e.g. "kimi", "deepseek"). */
  name: string;
  /** Raw model output. */
  output: string;
}

export interface JudgeInput {
  /** Original user topic / question. */
  topic: string;
  /** Candidate outputs to compare. 2-3 items. */
  candidates: JudgeCandidateInput[];
  /**
   * Optional template type. Today only "default" is supported; the
   * field is kept for forward compatibility (e.g. "risk-aware",
   * "creative") without changing the call signature.
   */
  template?: 'default';
}

export interface ProviderOutput {
  provider: string;
  output: string;
}

export interface JudgeResult {
  content: string;
  /** Name of the provider that produced `content` (either the winner or the fallback). */
  modelUsed: string;
  /** The winning provider (when Judge succeeded), or `null` when we degraded. */
  winner: string | null;
  /** Raw candidate outputs, keyed by provider name. */
  providerOutputs: Record<string, string>;
  /** Judge analysis, or `null` when we degraded. */
  analysis: string | null;
  /** Judge scores, or `null` when we degraded. */
  scores: Record<string, number> | null;
}

interface ParsedJudge {
  analysis?: unknown;
  winner?: unknown;
  scores?: unknown;
  reasons?: unknown;
}

/**
 * JudgeService is the final stage of the complex routing path.
 *
 * It takes 2-3 candidate outputs, asks a Judge LLM to pick the best
 * one, and returns the winning content along with provenance
 * (which provider won, what the Judge said, and the original outputs).
 *
 * Failure / degradation contract:
 *   - If FeatureFlags.JUDGE_ENABLED is false → return the first
 *     candidate verbatim, with `winner: null`.
 *   - If the Judge call throws or times out → return the first
 *     candidate verbatim, with `winner: null` and a logged warning.
 *   - If the Judge call returns unparsable JSON → same as above.
 *   - If the Judge returns a winner label we cannot map back to a
 *     provider (e.g. "modelA" but candidates are empty) → fall back
 *     to the first candidate.
 *   - If `candidates` is empty → return an empty result with
 *     `modelUsed: ''`. We do *not* throw, because the caller is
 *     typically an HTTP handler that should still respond with 200
 *     and an empty body rather than a 500.
 */
@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  /** Provider used as the Judge. Defaults to 'kimi'. */
  private readonly judgeProviderName: string;

  constructor(
    private readonly registry: LLMProviderRegistry,
    judgeProviderName: string = 'kimi',
  ) {
    this.judgeProviderName = judgeProviderName;
  }

  /**
   * Run the Judge over `input.candidates` and return the winning
   * content. Never throws — every error path is converted into a
   * degraded result so the HTTP layer can return 200.
   */
  async judge(input: JudgeInput): Promise<JudgeResult> {
    const topic = input.topic ?? '';
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const providerOutputs: Record<string, string> = {};
    for (const c of candidates) {
      if (c && typeof c.name === 'string' && c.name.length > 0) {
        providerOutputs[c.name] = c.output ?? '';
      }
    }

    const fallback = this.buildFallbackResult(providerOutputs, candidates);

    if (!FeatureFlags.JUDGE_ENABLED) {
      return fallback;
    }
    if (candidates.length < 2) {
      // Single candidate — nothing to judge. We still return it as
      // a degraded result so the caller does not need to branch.
      return fallback;
    }

    let provider;
    try {
      provider = this.registry.get(this.judgeProviderName);
    } catch (err) {
      this.logger.warn(
        `Judge provider "${this.judgeProviderName}" unavailable, falling back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }

    const prompt = this.buildPrompt(input, candidates);
    const params: ChatCompletionParams = {
      messages: [
        {
          role: 'system',
          content:
            'You are an impartial Judge LLM. ' +
            'Compare the following model outputs across these dimensions: ' +
            renderEvaluationDimensionsLine() +
            '. Return strict JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    };

    let result: ChatCompletionResult;
    try {
      result = await this.callWithTimeout(
        provider,
        params,
        DEFAULT_JUDGE_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Judge call failed, falling back to first candidate: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }

    const parsed = this.parseJudgeResponse(result.content);
    if (!parsed) {
      this.logger.warn(
        `Judge returned unparsable content, falling back to first candidate. Raw: ${this.truncate(
          result.content,
          200,
        )}`,
      );
      return fallback;
    }

    const winnerLabel = this.normalizeWinner(parsed.winner, candidates.length);
    const winnerProvider = winnerLabel && winnerLabel !== 'tie'
      ? this.labelToProvider(winnerLabel, candidates)
      : null;

    if (!winnerProvider) {
      this.logger.warn(
        `Judge winner "${String(parsed.winner)}" could not be mapped to a provider, falling back.`,
      );
      return fallback;
    }

    const winnerContent = providerOutputs[winnerProvider] ?? '';
    const scores = this.normalizeScores(parsed.scores, candidates);

    return {
      content: winnerContent,
      modelUsed: winnerProvider,
      winner: winnerProvider,
      providerOutputs,
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : null,
      scores,
    };
  }

  /**
   * Build the multi-model prompt. Falls back to the legacy 2-model
   * template via `buildJudgePromptMulti` even for 2-candidate runs
   * (it handles both lengths).
   */
  private buildPrompt(input: JudgeInput, candidates: JudgeCandidateInput[]): string {
    const cands: MultiJudgeCandidate[] = candidates.map((c) => ({
      name: c.name,
      output: c.output ?? '',
    }));
    return buildJudgePromptMulti({
      topic: input.topic ?? '',
      candidates: cands,
    });
  }

  /**
   * Map a "modelA" / "modelB" / "modelC" label back to a provider
   * name. Returns `null` when the label is out of range.
   */
  private labelToProvider(label: string, candidates: JudgeCandidateInput[]): string | null {
    const idx = ['modelA', 'modelB', 'modelC'].indexOf(label);
    if (idx < 0 || idx >= candidates.length) return null;
    const c = candidates[idx];
    return c && c.name ? c.name : null;
  }

  /**
   * Normalize the winner field from the Judge. Accepts "modelA",
   * "modelB", "modelC", or "tie". Anything else → null.
   */
  private normalizeWinner(raw: unknown, candidateCount: number): string | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim().toLowerCase();
    if (v === 'tie') return 'tie';
    if (candidateCount >= 1 && v === 'modela') return 'modelA';
    if (candidateCount >= 2 && v === 'modelb') return 'modelB';
    if (candidateCount >= 3 && v === 'modelc') return 'modelC';
    if (candidateCount >= 1 && /^a$/i.test(v)) return 'modelA';
    if (candidateCount >= 2 && /^b$/i.test(v)) return 'modelB';
    if (candidateCount >= 3 && /^c$/i.test(v)) return 'modelC';
    return null;
  }

  /**
   * Normalize the scores object. We accept both the multi-model
   * shape (`{modelA, modelB, modelC}`) and the legacy 2-model shape
   * (`{scoreA, scoreB}`) to be lenient with the Judge LLM.
   */
  private normalizeScores(
    raw: unknown,
    candidates: JudgeCandidateInput[],
  ): Record<string, number> | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const out: Record<string, number> = {};
    const aliases: Array<[string, string]> = [
      ['modelA', 'modelA'],
      ['modelB', 'modelB'],
      ['modelC', 'modelC'],
      ['scoreA', 'modelA'],
      ['scoreB', 'modelB'],
      ['scoreC', 'modelC'],
    ];
    let touched = false;
    for (const [key, label] of aliases) {
      const v = obj[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const clamped = Math.max(0, Math.min(10, Math.round(v)));
        out[label] = clamped;
        touched = true;
      }
    }
    if (!touched) return null;
    return out;
  }

  /**
   * Parse the Judge's response. We accept:
   *   - a raw JSON object
   *   - a ```json ... ``` fenced JSON object (we strip the fence)
   *   - any text that contains a JSON object (we grab the first
   *     balanced one)
   */
  private parseJudgeResponse(text: string): ParsedJudge | null {
    if (typeof text !== 'string' || text.length === 0) return null;
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    // Try a direct parse first.
    try {
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj === 'object') return obj as ParsedJudge;
    } catch {
      // fall through to bracket scan
    }

    // Scan for the first balanced { ... } block.
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(start, i + 1);
          try {
            const obj = JSON.parse(candidate);
            if (obj && typeof obj === 'object') return obj as ParsedJudge;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Build a degraded JudgeResult from the first available candidate.
   * Used for every failure path so the caller can rely on the same
   * shape regardless of what went wrong.
   */
  private buildFallbackResult(
    providerOutputs: Record<string, string>,
    candidates: JudgeCandidateInput[],
  ): JudgeResult {
    const first = candidates[0];
    const name = first?.name ?? '';
    const content = first?.output ?? '';
    return {
      content,
      modelUsed: name,
      winner: null,
      providerOutputs,
      analysis: null,
      scores: null,
    };
  }

  private async callWithTimeout(
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
            `Judge provider ${provider.name} timed out after ${safeTimeout}ms`,
            true,
          ),
        );
      }, safeTimeout);

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

  private truncate(text: string, max: number): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
