/**
 * Pros / Cons analysis prompt.
 *
 * Asks for a balanced list of advantages and disadvantages plus a short
 * overall analysis string. The JSON shape is deliberately simple so that
 * the Judge model in U5 can compare two competing responses field by
 * field.
 */
export function buildProsConsPrompt(topic: string): string {
  return [
    'You are a decision coach. Produce a balanced pros/cons analysis of the topic below.',
    'Return STRICT JSON only, with no markdown fences, no commentary, and no extra keys.',
    '',
    'Topic:',
    topic,
    '',
    'Output schema (JSON object):',
    '{',
    '  "analysis": "<one-paragraph overall judgement as a string>",',
    '  "pros": ["<pro 1>", "<pro 2>", "..."],',
    '  "cons": ["<con 1>", "<con 2>", "..."]',
    '}',
    '',
    'Constraints:',
    '- `pros` and `cons` must each contain 3 to 5 items.',
    '- Pros and cons must be parallel in scope (one per distinct dimension).',
    '- Be specific to the topic. Avoid filler phrases.',
    '- Output must be valid JSON parseable by JSON.parse().',
  ].join('\n');
}
