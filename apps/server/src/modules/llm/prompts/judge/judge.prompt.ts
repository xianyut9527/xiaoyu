/**
 * Judge prompt.
 *
 * The Judge model receives competing model outputs (and the original
 * topic) and must return a single JSON object describing which one is
 * best and why. The placeholders below are filled in by the
 * orchestrator (U5) before the prompt is sent to the LLM.
 *
 * Two variants are exposed:
 *   - JUDGE_PROMPT_TEMPLATE  (legacy 2-model version, kept stable
 *     because the prototype script in scripts/ depends on it)
 *   - buildJudgePromptMulti  (new version that supports 2-3 models,
 *     used by JudgeService)
 *
 * Multi-model placeholders:
 *   {{topic}}               - the original user topic / question
 *   {{modelsBlock}}         - the rendered "Model X (name): ..." block
 *   {{modelLabels}}         - e.g. "modelA, modelB, modelC"
 *   {{candidatesJson}}      - JSON string of the candidate outputs,
 *                             included so the judge can re-derive
 *                             numbers without re-parsing the prompt.
 *
 * Output schema (enforced by JudgeService):
 *   {
 *     "analysis":   "<one-paragraph comparison>",
 *     "winner":     "<modelA|modelB|modelC|tie>",
 *     "scores":     { "modelA": <0-10>, "modelB": <0-10>, "modelC": <0-10> },
 *     "reasons":    ["<reason 1>", "<reason 2>", ...]
 *   }
 */

export const JUDGE_PROMPT_TEMPLATE = [
  'You are an impartial judge comparing two AI responses to the same prompt.',
  'Return STRICT JSON only, with no markdown fences, no commentary, and no extra keys.',
  '',
  'Topic: {{topic}}',
  '',
  'Model A: {{modelA}}',
  'Model A output:',
  '"""',
  '{{modelAOutput}}',
  '"""',
  '',
  'Model B: {{modelB}}',
  'Model B output:',
  '"""',
  '{{modelBOutput}}',
  '"""',
  '',
  'Output schema (JSON object):',
  '{',
  '  "analysis": "<one-paragraph comparison as a string>",',
  '  "winner": "<modelA|modelB|tie>",',
  '  "scoreA": <integer 0-10>,',
  '  "scoreB": <integer 0-10>,',
  '  "reasons": ["<reason 1>", "<reason 2>", "..."]',
  '}',
  '',
  'Constraints:',
  '- `scoreA` and `scoreB` must be integers in the range [0, 10].',
  '- `winner` must be exactly "modelA", "modelB", or "tie".',
  '- `reasons` must contain 2 to 4 short, concrete justifications.',
  '- Output must be valid JSON parseable by JSON.parse().',
].join('\n');

export interface JudgePromptInput {
  topic: string;
  modelA: string;
  modelB: string;
  modelAOutput: string;
  modelBOutput: string;
}

export function buildJudgePrompt(input: JudgePromptInput): string {
  return JUDGE_PROMPT_TEMPLATE
    .replace('{{topic}}', input.topic)
    .replace('{{modelA}}', input.modelA)
    .replace('{{modelB}}', input.modelB)
    .replace('{{modelAOutput}}', input.modelAOutput)
    .replace('{{modelBOutput}}', input.modelBOutput);
}

export const JUDGE_PROMPT_MULTI_TEMPLATE = [
  'You are an impartial judge comparing {{count}} AI responses to the same prompt.',
  'Return STRICT JSON only, with no markdown fences, no commentary, and no extra keys.',
  '',
  'Topic: {{topic}}',
  '',
  '{{modelsBlock}}',
  '',
  'Candidate outputs (machine-readable, for reference):',
  '{{candidatesJson}}',
  '',
  'Output schema (JSON object):',
  '{',
  '  "analysis": "<one-paragraph comparison as a string>",',
  '  "winner": "<modelA|modelB|modelC|tie>",',
  '  "scores": { "modelA": <0-10>, "modelB": <0-10>, "modelC": <0-10> },',
  '  "reasons": ["<reason 1>", "<reason 2>", "..."]',
  '}',
  '',
  'Constraints:',
  '- `scores` must contain an integer in [0, 10] for every model label listed in {{modelLabels}}.',
  '- `winner` must be one of {{modelLabels}} or exactly "tie".',
  '- `reasons` must contain 2 to 4 short, concrete justifications.',
  '- Output must be valid JSON parseable by JSON.parse().',
].join('\n');

export interface MultiJudgeCandidate {
  /** Provider name (e.g. "kimi"). Will be exposed to the judge as-is. */
  name: string;
  /** Raw model output. */
  output: string;
}

export interface JudgePromptMultiInput {
  topic: string;
  candidates: MultiJudgeCandidate[];
}

const VALID_LABELS = ['modelA', 'modelB', 'modelC'] as const;
export type JudgeModelLabel = (typeof VALID_LABELS)[number];

/**
 * Build a multi-model Judge prompt. Supports 2 or 3 candidates (which
 * matches the hard ceiling of 3 parallel models in U5). For 1 candidate
 * we throw — judging a single output is meaningless and the caller
 * should not have invoked the Judge in that case.
 */
export function buildJudgePromptMulti(input: JudgePromptMultiInput): string {
  const { topic, candidates } = input;
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 3) {
    throw new Error(
      `buildJudgePromptMulti requires 2 or 3 candidates, got ${candidates?.length ?? 0}`,
    );
  }

  const labels: JudgeModelLabel[] = [];
  const blocks: string[] = [];
  const candidateMap: Record<string, string> = {};

  candidates.forEach((c, idx) => {
    const label = VALID_LABELS[idx];
    labels.push(label);
    blocks.push(
      [
        `${label.toUpperCase()} (${c.name}):`,
        '"""',
        c.output,
        '"""',
      ].join('\n'),
    );
    candidateMap[label] = c.output;
  });

  // Pad the candidate map so the JSON is stable for 2-candidate runs.
  for (let i = candidates.length; i < 3; i++) {
    candidateMap[VALID_LABELS[i]] = '';
  }

  const modelsBlock = blocks.join('\n\n');
  const modelLabels = labels.join(', ');

  return JUDGE_PROMPT_MULTI_TEMPLATE
    .replace('{{count}}', String(candidates.length))
    .replace('{{topic}}', topic)
    .replace('{{modelsBlock}}', modelsBlock)
    .replace('{{modelLabels}}', modelLabels)
    .replace('{{candidatesJson}}', JSON.stringify(candidateMap));
}
