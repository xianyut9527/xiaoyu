/**
 * Decision-tree analysis prompt.
 *
 * Produces a small decision tree where each node has a question, an
 * expected answer set, and child branches. The shape is intentionally
 * shallow (depth <= 3) to keep it tractable for the judging model in U5.
 */
export function buildDecisionTreePrompt(topic: string): string {
  return [
    'You are a decision analyst. Build a small decision tree for the topic below.',
    'Return STRICT JSON only, with no markdown fences, no commentary, and no extra keys.',
    '',
    'Topic:',
    topic,
    '',
    'Output schema (JSON object):',
    '{',
    '  "analysis": "<one-paragraph rationale as a string>",',
    '  "branches": [',
    '    {',
    '      "id": "root",',
    '      "question": "<the decision question>",',
    '      "options": [',
    '        { "label": "<option A>", "outcome": "<expected outcome>", "nextId": "<child id or null>" },',
    '        { "label": "<option B>", "outcome": "<expected outcome>", "nextId": "<child id or null>" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Constraints:',
    '- The first branch MUST have id "root".',
    '- Each branch id must be unique.',
    '- Each `options` array should contain 2 to 3 entries.',
    '- `nextId` references another branch id, or null for a terminal node.',
    '- Output must be valid JSON parseable by JSON.parse().',
  ].join('\n');
}
