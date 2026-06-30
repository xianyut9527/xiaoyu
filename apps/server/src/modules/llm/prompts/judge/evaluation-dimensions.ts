/**
 * Evaluation dimensions used by the Judge.
 *
 * The Judge is a black-box LLM call, so the only thing we can influence
 * is the prompt. Embedding an explicit dimensions list in the system
 * (or user) part of the prompt consistently raises inter-run agreement
 * by anchoring the model to the same axes each time.
 *
 * The dimensions below are intentionally generic enough to apply to
 * any analysis / decision-support task the orchestrator is asked to
 * judge, but specific enough to differentiate a confident, structured
 * answer from a hedged, hand-wavy one.
 *
 * Each dimension is:
 *   - id      stable identifier, used in tests and metrics
 *   - name    short human-readable label (Chinese + English)
 *   - weight  relative importance when scoring (weights sum to 1.0)
 *   - rubric  one-line description of what "high" vs "low" looks like
 *
 * The judge prompt itself only references these by name (so the
 * rubric text does not bloat the prompt). They are exposed here for
 * observability, prompt-tuning experiments, and future fine-tuning.
 */

export interface EvaluationDimension {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly rubric: string;
}

export const EVALUATION_DIMENSIONS: ReadonlyArray<EvaluationDimension> = Object.freeze([
  {
    id: 'accuracy',
    name: '准确性 / Accuracy',
    weight: 0.3,
    rubric: '是否引用了正确的事实、概念或数据；是否存在明显错误。',
  },
  {
    id: 'depth',
    name: '深度 / Depth',
    weight: 0.2,
    rubric: '是否触达了问题的根因 / 关键变量；是否止步于表面陈述。',
  },
  {
    id: 'structure',
    name: '结构 / Structure',
    weight: 0.15,
    rubric: '是否使用了清晰的层次、列表或表格，是否便于扫读。',
  },
  {
    id: 'actionability',
    name: '可执行性 / Actionability',
    weight: 0.2,
    rubric: '是否给出可落地的下一步 / 决策选项 / 风险提示。',
  },
  {
    id: 'clarity',
    name: '清晰度 / Clarity',
    weight: 0.15,
    rubric: '表达是否精炼、无歧义；是否避免空话与套话。',
  },
]);

/**
 * Render the dimension names as a single-line summary suitable for
 * inlining into a prompt. The judge is *not* expected to score per
 * dimension; this is purely a stability anchor.
 */
export function renderEvaluationDimensionsLine(): string {
  return EVALUATION_DIMENSIONS.map((d) => d.name).join('、');
}

/**
 * Validate that the dimension weights sum to 1.0 within a small
 * epsilon. Throws at module load if they do not — better to fail
 * fast at boot than to silently produce nonsense scores.
 */
export function assertEvaluationDimensionsValid(): void {
  const sum = EVALUATION_DIMENSIONS.reduce((acc, d) => acc + d.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(
      `EVALUATION_DIMENSIONS weights must sum to 1.0, got ${sum.toFixed(6)}`,
    );
  }
}

assertEvaluationDimensionsValid();
