/**
 * U5 unit tests: routing, parallel fan-out, judge.
 *
 * We deliberately do NOT use @nestjs/testing here. Constructing the
 * services directly with hand-rolled mocks is faster, more obvious
 * to read, and isolates the unit from any boot-time side effects of
 * the real providers (e.g. KimiProvider throws if KIMI_API_KEY is
 * missing). The DI graph is trivial (each service takes a registry
 * that is itself a thin wrapper over a Map), so there is no value
 * in pulling in the full Nest container.
 */
import { FeatureFlags } from '../config/features';
import { RoutingDecision, RoutingService } from '../services/routing.service';
import { ParallelLLMService } from '../services/parallel-llm.service';
import { JudgeService } from '../services/judge.service';
import { LLMProviderRegistry } from '../services/provider.registry';
import {
  ChatCompletionParams,
  ChatCompletionResult,
  LLMError,
  LLMErrorCode,
  LLMProvider,
} from '../interfaces/llm-provider.interface';
import { MockProvider } from '../providers/mock.provider';

/* --------------------------------------------------------------------- */
/* Helpers                                                                */
/* --------------------------------------------------------------------- */

class ScriptedProvider implements LLMProvider {
  public readonly name: string;
  private readonly responses: Array<
    { kind: 'ok'; result: ChatCompletionResult } | { kind: 'err'; error: Error } | { kind: 'hang' }
  >;
  private cursor = 0;
  public calls: ChatCompletionParams[] = [];

  constructor(
    name: string,
    responses: Array<
      { kind: 'ok'; result: ChatCompletionResult } | { kind: 'err'; error: Error } | { kind: 'hang' }
    >,
  ) {
    this.name = name;
    this.responses = responses;
  }

  async chat(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    this.calls.push(params);
    const step = this.responses[this.cursor++] ?? this.responses[this.responses.length - 1];
    if (step.kind === 'ok') return step.result;
    if (step.kind === 'err') throw step.error;
    // hang: never resolves
    return new Promise<ChatCompletionResult>(() => {
      /* never */
    });
  }

  async *chatStream(): AsyncIterable<{ content: string; metadata?: Record<string, unknown> }> {
    throw new Error('not used in tests');
  }
}

function makeRegistry(providers: LLMProvider[]): LLMProviderRegistry {
  // The registry constructor takes an array of providers; for unit
  // tests we instantiate it directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new LLMProviderRegistry(providers as any);
}

const baseParams: ChatCompletionParams = {
  messages: [{ role: 'user', content: 'hello' }],
};

/* --------------------------------------------------------------------- */
/* RoutingService                                                         */
/* --------------------------------------------------------------------- */

describe('RoutingService', () => {
  let originalEnabled: boolean;
  let routing: RoutingService;

  beforeEach(() => {
    originalEnabled = FeatureFlags.COMPLEX_ROUTE_ENABLED;
    // Force the flag on for these tests, regardless of .env.
    FeatureFlags.COMPLEX_ROUTE_ENABLED = true;
    routing = new RoutingService();
  });

  afterEach(() => {
    FeatureFlags.COMPLEX_ROUTE_ENABLED = originalEnabled;
  });

  it('returns SIMPLE for short messages with no keywords', () => {
    expect(routing.decide('hi', 0)).toBe(RoutingDecision.SIMPLE);
  });

  it('returns SIMPLE for an empty message', () => {
    expect(routing.decide('', 0)).toBe(RoutingDecision.SIMPLE);
  });

  it('returns COMPLEX for messages longer than 100 chars', () => {
    // Build a message we know is >=100 chars and contains no keyword,
    // so the only signal is the length threshold.
    const filler = '这句话仅用于凑字数以越过长度阈值并不触发任何关键词命中。';
    const long = filler.repeat(4);
    expect(long.length).toBeGreaterThanOrEqual(100);
    expect(routing.decide(long, 0)).toBe(RoutingDecision.COMPLEX);
  });

  it('returns COMPLEX when a complex keyword is present (Chinese)', () => {
    expect(routing.decide('帮我做一个 SWOT 分析', 0)).toBe(RoutingDecision.COMPLEX);
  });

  it('returns COMPLEX when a complex keyword is present (English, case-insensitive)', () => {
    expect(routing.decide('Please compare these two options', 0)).toBe(RoutingDecision.COMPLEX);
  });

  it('returns COMPLEX when turn count >= 3', () => {
    expect(routing.decide('继续', 3)).toBe(RoutingDecision.COMPLEX);
  });

  it('returns SIMPLE for short messages even at turn 2', () => {
    expect(routing.decide('继续', 2)).toBe(RoutingDecision.SIMPLE);
  });

  it('returns SIMPLE when COMPLEX_ROUTE_ENABLED is false, regardless of input', () => {
    FeatureFlags.COMPLEX_ROUTE_ENABLED = false;
    expect(routing.decide('Please analyze this in great detail', 10)).toBe(RoutingDecision.SIMPLE);
  });
});

/* --------------------------------------------------------------------- */
/* ParallelLLMService                                                     */
/* --------------------------------------------------------------------- */

describe('ParallelLLMService', () => {
  it('fans out to all providers and collects successes', async () => {
    const a = new ScriptedProvider('a', [
      { kind: 'ok', result: { content: 'A-out' } },
    ]);
    const b = new ScriptedProvider('b', [
      { kind: 'ok', result: { content: 'B-out' } },
    ]);
    const c = new ScriptedProvider('c', [
      { kind: 'ok', result: { content: 'C-out' } },
    ]);
    const registry = makeRegistry([a, b, c]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(baseParams, ['a', 'b', 'c'], 500);

    expect(out.errors).toEqual([]);
    expect(out.results.map((r) => r.content).sort()).toEqual(['A-out', 'B-out', 'C-out']);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(c.calls).toHaveLength(1);
  });

  it('collects LLMError failures and still returns the successes', async () => {
    const a = new ScriptedProvider('a', [
      { kind: 'ok', result: { content: 'A-out' } },
    ]);
    const b = new ScriptedProvider('b', [
      {
        kind: 'err',
        error: new LLMError(LLMErrorCode.RATE_LIMIT, 'b', 'rate limited', true),
      },
    ]);
    const registry = makeRegistry([a, b]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(baseParams, ['a', 'b'], 500);

    expect(out.results.map((r) => r.content)).toEqual(['A-out']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toBeInstanceOf(LLMError);
    expect(out.errors[0].code).toBe(LLMErrorCode.RATE_LIMIT);
    expect(out.errors[0].provider).toBe('b');
  });

  it('wraps non-LLMError rejections as LLMError(UNKNOWN)', async () => {
    const a = new ScriptedProvider('a', [
      { kind: 'ok', result: { content: 'A-out' } },
    ]);
    const b = new ScriptedProvider('b', [
      { kind: 'err', error: new Error('boom') },
    ]);
    const registry = makeRegistry([a, b]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(baseParams, ['a', 'b'], 500);

    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toBeInstanceOf(LLMError);
    expect(out.errors[0].code).toBe(LLMErrorCode.UNKNOWN);
    expect(out.errors[0].provider).toBe('b');
    expect(out.errors[0].message).toContain('boom');
  });

  it('times out a hanging provider and reports TIMEOUT', async () => {
    const a = new ScriptedProvider('a', [
      { kind: 'ok', result: { content: 'A-out' } },
    ]);
    const b = new ScriptedProvider('b', [{ kind: 'hang' }]);
    const registry = makeRegistry([a, b]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(baseParams, ['a', 'b'], 30);

    expect(out.results.map((r) => r.content)).toEqual(['A-out']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].code).toBe(LLMErrorCode.TIMEOUT);
    expect(out.errors[0].provider).toBe('b');
    expect(out.errors[0].retryable).toBe(true);
  });

  it('caps the provider list to the configured maximum (3)', async () => {
    const a = new ScriptedProvider('a', [{ kind: 'ok', result: { content: 'A' } }]);
    const b = new ScriptedProvider('b', [{ kind: 'ok', result: { content: 'B' } }]);
    const c = new ScriptedProvider('c', [{ kind: 'ok', result: { content: 'C' } }]);
    const d = new ScriptedProvider('d', [{ kind: 'ok', result: { content: 'D' } }]);
    const e = new ScriptedProvider('e', [{ kind: 'ok', result: { content: 'E' } }]);
    const registry = makeRegistry([a, b, c, d, e]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(
      baseParams,
      ['a', 'b', 'c', 'd', 'e'],
      500,
    );

    // First 3 names survive the cap; d and e are dropped.
    expect(out.results).toHaveLength(3);
    expect(out.results.map((r) => r.content).sort()).toEqual(['A', 'B', 'C']);
    expect(d.calls).toHaveLength(0);
    expect(e.calls).toHaveLength(0);
  });

  it('returns an LLMError when an unknown provider name is requested', async () => {
    const registry = makeRegistry([new MockProvider()]);
    const service = new ParallelLLMService(registry);

    const out = await service.chatParallel(baseParams, ['does-not-exist'], 500);

    expect(out.results).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toBeInstanceOf(LLMError);
    expect(out.errors[0].code).toBe(LLMErrorCode.UNKNOWN);
  });
});

/* --------------------------------------------------------------------- */
/* JudgeService                                                           */
/* --------------------------------------------------------------------- */

describe('JudgeService', () => {
  it('returns the winning content when the Judge picks one', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      {
        kind: 'ok',
        result: {
          content: JSON.stringify({
            analysis: 'B is more structured.',
            winner: 'modelB',
            scores: { modelA: 6, modelB: 9 },
            reasons: ['structure', 'actionability'],
          }),
        },
      },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'Compare A and B',
      candidates: [
        { name: 'deepseek', output: 'A-out' },
        { name: 'kimi', output: 'B-out' },
      ],
    });

    expect(result.modelUsed).toBe('kimi');
    expect(result.winner).toBe('kimi');
    expect(result.content).toBe('B-out');
    expect(result.providerOutputs).toEqual({ deepseek: 'A-out', kimi: 'B-out' });
    expect(result.analysis).toBe('B is more structured.');
    expect(result.scores).toEqual({ modelA: 6, modelB: 9 });
  });

  it('degrades to the first candidate when the Judge provider throws', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      { kind: 'err', error: new Error('judge exploded') },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'deepseek', output: 'A-out' },
        { name: 'kimi', output: 'B-out' },
      ],
    });

    expect(result.modelUsed).toBe('deepseek');
    expect(result.winner).toBeNull();
    expect(result.content).toBe('A-out');
    expect(result.analysis).toBeNull();
    expect(result.scores).toBeNull();
  });

  it('degrades when the Judge returns unparsable content', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      { kind: 'ok', result: { content: 'not even close to json' } },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'a', output: 'A-out' },
        { name: 'b', output: 'B-out' },
      ],
    });

    expect(result.winner).toBeNull();
    expect(result.modelUsed).toBe('a');
    expect(result.content).toBe('A-out');
  });

  it('degrades when the Judge returns a winner we cannot map', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      {
        kind: 'ok',
        result: {
          content: JSON.stringify({ winner: 'modelZ', scores: { modelZ: 9 } }),
        },
      },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'a', output: 'A-out' },
        { name: 'b', output: 'B-out' },
      ],
    });

    expect(result.winner).toBeNull();
    expect(result.content).toBe('A-out');
  });

  it('strips a ```json fence before parsing the Judge response', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      {
        kind: 'ok',
        result: {
          content:
            '```json\n' +
            JSON.stringify({
              analysis: 'A wins',
              winner: 'modelA',
              scores: { modelA: 9, modelB: 7 },
              reasons: ['a', 'b'],
            }) +
            '\n```',
        },
      },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'a', output: 'A-out' },
        { name: 'b', output: 'B-out' },
      ],
    });

    expect(result.winner).toBe('a');
    expect(result.content).toBe('A-out');
  });

  it('handles 3 candidates (modelC winner)', async () => {
    const judgeProvider = new ScriptedProvider('kimi', [
      {
        kind: 'ok',
        result: {
          content: JSON.stringify({
            analysis: 'C wins',
            winner: 'modelC',
            scores: { modelA: 5, modelB: 6, modelC: 9 },
            reasons: ['depth'],
          }),
        },
      },
    ]);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'a', output: 'A-out' },
        { name: 'b', output: 'B-out' },
        { name: 'c', output: 'C-out' },
      ],
    });

    expect(result.winner).toBe('c');
    expect(result.modelUsed).toBe('c');
    expect(result.content).toBe('C-out');
  });

  it('returns a degraded result when only one candidate is provided', async () => {
    const judgeProvider = new ScriptedProvider('kimi', []);
    const registry = makeRegistry([judgeProvider]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [{ name: 'a', output: 'A-out' }],
    });

    expect(result.winner).toBeNull();
    expect(result.modelUsed).toBe('a');
    expect(result.content).toBe('A-out');
    // Judge provider must not be called for 1-candidate runs.
    expect(judgeProvider.calls).toHaveLength(0);
  });

  it('falls back when the configured judge provider is not registered', async () => {
    const registry = makeRegistry([new ScriptedProvider('other', [])]);
    const service = new JudgeService(registry, 'kimi');

    const result = await service.judge({
      topic: 'topic',
      candidates: [
        { name: 'a', output: 'A-out' },
        { name: 'b', output: 'B-out' },
      ],
    });

    expect(result.winner).toBeNull();
    expect(result.modelUsed).toBe('a');
    expect(result.content).toBe('A-out');
  });
});
