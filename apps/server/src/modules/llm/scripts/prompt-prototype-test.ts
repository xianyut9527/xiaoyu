/**
 * Prompt prototype validation script (U4).
 *
 * Runs each strategy prompt through the MockProvider five times and
 * reports:
 *   - the prompt text
 *   - the average response length
 *   - the JSON parse success rate
 *
 * It does NOT call any real LLM. Its purpose is to confirm that the
 * prompt -> provider -> response pipeline is wired end-to-end so that U5
 * can plug in the real providers without surprises.
 *
 * Usage:
 *   pnpm --filter @xiaoyu/server test:prompt-prototype
 */

import { MockProvider } from '../providers/mock.provider';
import { ChatCompletionResult, LLMMessage } from '../interfaces/llm-provider.interface';
import { buildSwotPrompt } from '../prompts/strategy/swot.prompt';
import { buildDecisionTreePrompt } from '../prompts/strategy/decision-tree.prompt';
import { buildProsConsPrompt } from '../prompts/strategy/pros-cons.prompt';
import { buildJudgePrompt } from '../prompts/judge/judge.prompt';

interface PromptCase {
  readonly label: string;
  readonly build: () => string;
}

interface CaseResult {
  readonly label: string;
  readonly attempts: number;
  readonly parseable: number;
  readonly avgLength: number;
}

const SAMPLE_TOPIC = 'Should a small team adopt monorepo + pnpm workspaces in 2026?';
const ATTEMPTS_PER_CASE = 5;

function tryParseStructured(text: string): unknown | null {
  // Accept raw JSON or JSON wrapped in a single ```json fence.
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function safeLastUserContent(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}

async function runCase(
  provider: MockProvider,
  promptCase: PromptCase,
): Promise<CaseResult> {
  let parseable = 0;
  let totalLength = 0;
  for (let i = 0; i < ATTEMPTS_PER_CASE; i += 1) {
    const prompt = promptCase.build();
    const messages: LLMMessage[] = [{ role: 'user', content: prompt }];
    const result: ChatCompletionResult = await provider.chat({ messages });
    totalLength += result.content.length;
    if (tryParseStructured(result.content) !== null) {
      parseable += 1;
    }
  }
  return {
    label: promptCase.label,
    attempts: ATTEMPTS_PER_CASE,
    parseable,
    avgLength: Math.round(totalLength / ATTEMPTS_PER_CASE),
  };
}

async function main(): Promise<void> {
  const provider = new MockProvider();

  const cases: PromptCase[] = [
    { label: 'swot', build: () => buildSwotPrompt(SAMPLE_TOPIC) },
    {
      label: 'decision-tree',
      build: () => buildDecisionTreePrompt(SAMPLE_TOPIC),
    },
    { label: 'pros-cons', build: () => buildProsConsPrompt(SAMPLE_TOPIC) },
    {
      label: 'judge',
      build: () =>
        buildJudgePrompt({
          topic: SAMPLE_TOPIC,
          modelA: 'deepseek',
          modelB: 'kimi',
          modelAOutput: '[deepseek] mock response for: ' + SAMPLE_TOPIC,
          modelBOutput: '[kimi] mock response for: ' + SAMPLE_TOPIC,
        }),
    },
  ];

  // Sanity-check: the user content is exactly what we expect to echo.
  const probeMessages: LLMMessage[] = [{ role: 'user', content: 'hello' }];
  const probeResult = await provider.chat({ messages: probeMessages });
  const echoed = tryParseStructured(probeResult.content);
  if (
    !echoed ||
    typeof echoed !== 'object' ||
    (echoed as { echo?: unknown }).echo !== 'hello'
  ) {
    throw new Error('MockProvider self-check failed: did not echo the last user message.');
  }

  // eslint-disable-next-line no-console
  console.log(
    `prompt-prototype-test | provider=${provider.name} | sampleTopic="${SAMPLE_TOPIC}"`,
  );
  // eslint-disable-next-line no-console
  console.log(
    '| case          | attempts | parseable | parse_rate | avg_length |',
  );
  // eslint-disable-next-line no-console
  console.log(
    '|---------------|----------|-----------|------------|------------|',
  );

  for (const promptCase of cases) {
    const result = await runCase(provider, promptCase);
    const rate = (result.parseable / result.attempts) * 100;
    // eslint-disable-next-line no-console
    console.log(
      `| ${result.label.padEnd(13)} | ${String(result.attempts).padStart(8)} | ${String(
        result.parseable,
      ).padStart(9)} | ${rate.toFixed(1).padStart(8)}%  | ${String(
        result.avgLength,
      ).padStart(10)} |`,
    );
  }

  // Also exercise the streaming path so chunking regressions surface here.
  let streamedLength = 0;
  let chunkCount = 0;
  for await (const chunk of provider.chatStream({
    messages: probeMessages,
  })) {
    streamedLength += chunk.content.length;
    chunkCount += 1;
  }
  if (streamedLength !== probeResult.content.length) {
    throw new Error(
      `chatStream produced ${streamedLength} chars, expected ${probeResult.content.length} (chunks=${chunkCount})`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `stream-check     | chunks=${chunkCount} | length=${streamedLength} | ok`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `last-user-check  | "${safeLastUserContent(probeMessages)}" -> echo verified`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('prompt-prototype-test FAILED:', err);
  process.exitCode = 1;
});
