/**
 * SWOT analysis prompt.
 *
 * Asks the LLM to return a single JSON object that can be parsed by
 * downstream code (orchestrator / UI). The schema is described inline so
 * the prompt is self-contained and does not depend on the call site.
 */
export function buildSwotPrompt(topic: string): string {
  return [
    'You are a strategic analyst. Produce a SWOT analysis of the topic below.',
    'Return STRICT JSON only, with no markdown fences, no commentary, and no extra keys.',
    '',
    'Topic:',
    topic,
    '',
    'Output schema (JSON object):',
    '{',
    '  "analysis": "<one-paragraph overall summary as a string>",',
    '  "strengths": ["<strength 1>", "<strength 2>", "..."],',
    '  "weaknesses": ["<weakness 1>", "<weakness 2>", "..."],',
    '  "opportunities": ["<opportunity 1>", "<opportunity 2>", "..."],',
    '  "threats": ["<threat 1>", "<threat 2>", "..."]',
    '}',
    '',
    'Constraints:',
    '- Each array must contain 3 to 5 concise, non-overlapping items.',
    '- Be specific to the topic. Avoid generic advice.',
    '- Output must be valid JSON parseable by JSON.parse().',
  ].join('\n');
}
