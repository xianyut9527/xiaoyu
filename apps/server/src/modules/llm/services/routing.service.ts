import { Injectable } from '@nestjs/common';
import { FeatureFlags } from '../config/features';

/**
 * RoutingDecision describes whether a turn should be served by the
 * cheap single-model path or by the expensive multi-model + Judge path.
 */
export enum RoutingDecision {
  SIMPLE = 'SIMPLE',
  COMPLEX = 'COMPLEX',
}

/**
 * Keywords that strongly correlate with "the user wants structured,
 * comparative, or decision-supporting output" and therefore justify
 * the cost of running 2-3 models in parallel plus a Judge step.
 *
 * The list is intentionally bilingual (zh + en) because the product
 * targets Chinese-speaking operators. It can be tuned at runtime by
 * adding to the set in `decide()` — it is *not* exposed as a feature
 * flag because that would let non-engineers change routing semantics.
 */
const COMPLEX_KEYWORDS: ReadonlyArray<string> = [
  '分析', '建议', '比较', 'SWOT', '决策', '利弊', '评估', '方案',
  // English counterparts so the routing also works for mixed-language turns.
  'analyze', 'analysis', 'recommend', 'compare', 'decision', 'pros and cons',
  'evaluate', 'plan',
];

/**
 * Length threshold (in characters) above which a message is treated as
 * a complex request. 100 chars roughly maps to a couple of sentences —
 * short enough that a normal user question with a small context block
 * does not cross it, but short enough that a real analysis request
 * almost always does.
 */
const COMPLEX_LENGTH_THRESHOLD = 100;

/**
 * Turn count threshold. When the conversation is in a deep back-and-forth
 * (>= 3 user turns in the same session) we treat the next turn as complex
 * because context is now significant and a single model is more likely to
 * lose track than a parallel ensemble.
 */
const COMPLEX_TURN_THRESHOLD = 3;

/**
 * RoutingService decides between the simple single-model path and the
 * complex multi-model + Judge path.
 *
 * The function is intentionally pure (no I/O, no clock) so it is easy
 * to unit-test and cheap to call from request hot paths. The only
 * dependency is `FeatureFlags`, which is a frozen plain object.
 */
@Injectable()
export class RoutingService {
  /**
   * Decide which path a turn should take.
   *
   * @param userMessage The latest user message (raw, untrimmed).
   * @param turnCount   Number of user turns already in the session
   *                    (0 for the first turn). Defaults to 0.
   * @returns SIMPLE or COMPLEX.
   */
  decide(userMessage: string, turnCount: number = 0): RoutingDecision {
    if (!FeatureFlags.COMPLEX_ROUTE_ENABLED) {
      return RoutingDecision.SIMPLE;
    }

    const text = userMessage ?? '';
    const lower = text.toLowerCase();

    const isComplex =
      text.length >= COMPLEX_LENGTH_THRESHOLD ||
      COMPLEX_KEYWORDS.some((k) => lower.includes(k.toLowerCase())) ||
      turnCount >= COMPLEX_TURN_THRESHOLD;

    return isComplex ? RoutingDecision.COMPLEX : RoutingDecision.SIMPLE;
  }
}
