/**
 * U7 unit tests for the analysis templates and AnalysisService.
 *
 * Tests are written without `@nestjs/testing` so we can keep
 * the suite dependency-free and fast. The DI graph is trivial
 * (two services + two repositories) so we hand-roll the
 * collaborators with the exact shape TypeORM expects.
 */
import { SwotTemplate } from '../templates/swot.template';
import { DecisionTreeTemplate } from '../templates/decision-tree.template';
import { ProsConsTemplate } from '../templates/pros-cons.template';
import { tryParseStructured } from '../templates/parse-utils';
import { AnalysisService } from '../services/analysis.service';
import { FeatureFlags } from '../../llm/config/features';
import { LLMError, LLMErrorCode, LLMProvider } from '../../llm/interfaces/llm-provider.interface';
import {
  ChatCompletionParams,
  ChatCompletionResult,
} from '../../llm/interfaces/llm-provider.interface';

/* --------------------------------------------------------------------- */
/* Template shape                                                        */
/* --------------------------------------------------------------------- */

describe('Analysis templates', () => {
  const templates = [SwotTemplate, DecisionTreeTemplate, ProsConsTemplate];

  it('exports exactly three templates with the expected ids', () => {
    const ids = templates.map((t) => t.id).sort();
    expect(ids).toEqual(['decision_tree', 'pros_cons', 'swot']);
  });

  it.each(templates)('$name has non-empty metadata', (t) => {
    expect(t.name.length).toBeGreaterThan(0);
    expect(t.description.length).toBeGreaterThan(0);
    expect(t.icon.length).toBeGreaterThan(0);
    expect(Array.isArray(t.formSchema)).toBe(true);
    expect(t.formSchema.length).toBeGreaterThan(0);
    for (const field of t.formSchema) {
      expect(field.key).toBeTruthy();
      expect(field.label).toBeTruthy();
      expect(['text', 'textarea', 'number']).toContain(field.type);
    }
  });

  it('SwotTemplate.buildPrompt delegates to the shared U4 builder', () => {
    const prompt = SwotTemplate.buildPrompt({ topic: 'AI startup' });
    expect(prompt).toContain('AI startup');
    // The U4 builder inlines the SWOT schema, so we can match on
    // a stable string the builder is known to emit.
    expect(prompt.toLowerCase()).toContain('swot');
  });

  it('buildPrompt handles empty input defensively', () => {
    const prompt = SwotTemplate.buildPrompt({});
    // No throw, returns *some* string.
    expect(typeof prompt).toBe('string');
  });
});

/* --------------------------------------------------------------------- */
/* parseOutput                                                            */
/* --------------------------------------------------------------------- */

describe('SwotTemplate.parseOutput', () => {
  it('extracts the structured SWOT fields from a JSON response', () => {
    const json = JSON.stringify({
      analysis: 'Overall summary.',
      strengths: ['a', 'b'],
      weaknesses: ['c'],
      opportunities: ['d', 'e'],
      threats: ['f'],
    });

    const result = SwotTemplate.parseOutput(json);
    expect(result.type).toBe('swot');
    expect(result.analysis).toBe('Overall summary.');
    expect(result.structured).toEqual({
      analysis: 'Overall summary.',
      strengths: ['a', 'b'],
      weaknesses: ['c'],
      opportunities: ['d', 'e'],
      threats: ['f'],
    });
  });

  it('falls back to the raw content when the model returns prose only', () => {
    const result = SwotTemplate.parseOutput('Just a freeform answer.');
    expect(result.type).toBe('swot');
    expect(result.analysis).toBe('Just a freeform answer.');
    expect(result.structured).toEqual({});
  });

  it('strips ```json fences before parsing', () => {
    const body = JSON.stringify({
      analysis: 'stripped',
      strengths: ['x'],
      weaknesses: ['y'],
      opportunities: ['z'],
      threats: ['w'],
    });
    const fenced = '```json\n' + body + '\n```';
    const result = SwotTemplate.parseOutput(fenced);
    expect(result.analysis).toBe('stripped');
  });
});

describe('DecisionTreeTemplate.parseOutput', () => {
  it('returns a structured response with branches', () => {
    const json = JSON.stringify({
      analysis: 'rationale',
      branches: [
        {
          id: 'root',
          question: 'q',
          options: [
            { label: 'A', outcome: 'o', nextId: null },
            { label: 'B', outcome: 'o', nextId: null },
          ],
        },
      ],
    });
    const out = DecisionTreeTemplate.parseOutput(json);
    expect(out.type).toBe('decision_tree');
    expect(out.analysis).toBe('rationale');
    expect(Array.isArray(out.structured.branches)).toBe(true);
  });
});

describe('ProsConsTemplate.parseOutput', () => {
  it('returns a structured response with pros and cons', () => {
    const json = JSON.stringify({
      analysis: 'verdict',
      pros: ['p1', 'p2'],
      cons: ['c1', 'c2'],
    });
    const out = ProsConsTemplate.parseOutput(json);
    expect(out.type).toBe('pros_cons');
    expect(out.analysis).toBe('verdict');
    expect(out.structured.pros).toEqual(['p1', 'p2']);
    expect(out.structured.cons).toEqual(['c1', 'c2']);
  });
});

describe('tryParseStructured helper', () => {
  it('returns null on empty / non-string input', () => {
    expect(tryParseStructured('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tryParseStructured(undefined as any)).toBeNull();
  });

  it('returns null when no JSON object is present', () => {
    expect(tryParseStructured('no json here')).toBeNull();
  });

  it('extracts a JSON object embedded in surrounding prose', () => {
    const result = tryParseStructured('Here you go: {"a": 1} cheers');
    expect(result).toEqual({ a: 1 });
  });
});

/* --------------------------------------------------------------------- */
/* AnalysisService.stream                                                  */
/* --------------------------------------------------------------------- */

class ScriptedProvider implements LLMProvider {
  public readonly name: string;
  private readonly outputs: ChatCompletionResult[];
  public calls: ChatCompletionParams[] = [];

  constructor(name: string, outputs: ChatCompletionResult[]) {
    this.name = name;
    this.outputs = outputs;
  }

  async chat(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    this.calls.push(params);
    return this.outputs.shift() ?? { content: '{}' };
  }

  async *chatStream(): AsyncIterable<{ content: string; metadata?: Record<string, unknown> }> {
    throw new Error('not used in tests');
  }
}

interface FakeRepo<T> {
  saved: T[];
  create: (input: Partial<T>) => T;
  save: (entity: T) => Promise<T>;
}

function makeRepoStub<T extends { id?: string }>(): FakeRepo<T> {
  const saved: T[] = [];
  return {
    saved,
    create: (input: Partial<T>) => ({ id: 'req-1', ...input } as T),
    save: async (entity: T) => {
      saved.push(entity);
      return entity;
    },
  };
}

function makeService(
  providers: LLMProvider[],
  judgeJSON: string,
): { service: AnalysisService; reqRepo: FakeRepo<{ id: string; templateType: string; input: Record<string, unknown>; userId: string }>; resRepo: FakeRepo<{ id: string; requestId: string; content: string; providerOutputs: Record<string, unknown> | null; judgeModel: string }> } {
  const { LLMProviderRegistry } = require('../../llm/services/provider.registry') as typeof import('../../llm/services/provider.registry');
  const { ParallelLLMService } = require('../../llm/services/parallel-llm.service') as typeof import('../../llm/services/parallel-llm.service');
  const { JudgeService } = require('../../llm/services/judge.service') as typeof import('../../llm/services/judge.service');

  // Build a Judge provider that always returns `judgeJSON`.
  const judgeProvider = new ScriptedProvider('kimi', [
    { content: judgeJSON },
  ]);
  const allProviders = [...providers, judgeProvider];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry = new LLMProviderRegistry(allProviders as any);
  const parallel = new ParallelLLMService(registry);
  const judge = new JudgeService(registry, 'kimi');

  const reqRepo = makeRepoStub<{ id: string; templateType: string; input: Record<string, unknown>; userId: string }>();
  const resRepo = makeRepoStub<{ id: string; requestId: string; content: string; providerOutputs: Record<string, unknown> | null; judgeModel: string }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AnalysisService(parallel, judge, reqRepo as any, resRepo as any);
  return { service, reqRepo, resRepo };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('AnalysisService', () => {
  let originalParallel: number;
  let originalJudge: boolean;

  beforeEach(() => {
    originalParallel = FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS;
    originalJudge = FeatureFlags.JUDGE_ENABLED;
    FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS = 2;
    // Keep Judge enabled so we can assert judge-specific behaviour.
    FeatureFlags.JUDGE_ENABLED = true;
  });

  afterEach(() => {
    FeatureFlags.COMPLEX_ROUTE_PARALLEL_MODELS = originalParallel;
    FeatureFlags.JUDGE_ENABLED = originalJudge;
  });

  it('listTemplates returns the three strategy templates in stable order', () => {
    const { service } = makeService([], '{}');
    const list = service.listTemplates();
    expect(list).toHaveLength(3);
    expect(list.map((t) => t.id)).toEqual(['swot', 'decision_tree', 'pros_cons']);
  });

  it('emits a full SSE event sequence on the happy path', async () => {
    const a = new ScriptedProvider('kimi', [
      { content: JSON.stringify({ analysis: 'A-analysis', strengths: ['s1'] }) },
    ]);
    const b = new ScriptedProvider('deepseek', [
      { content: JSON.stringify({ analysis: 'B-analysis', strengths: ['s2'] }) },
    ]);
    const judgeJSON = JSON.stringify({
      analysis: 'B-analysis',
      winner: 'B',
      scores: { modelA: 6, modelB: 9 },
    });
    const { service, reqRepo, resRepo } = makeService([a, b], judgeJSON);

    const events = await collect(
      service.createStream('user-1', {
        query: 'Should we expand?',
        type: 'swot',
      }),
    );

    // message_start
    expect(events[0].event).toBe('message_start');
    expect(events[0].data.requestId).toBeTruthy();
    expect(events[0].data.type).toBe('swot');

    // deltas: the winning candidate content is streamed in chunks.
    const deltas = events.filter((e) => e.event === 'message_delta');
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    const joined = deltas.map((d) => d.data.content ?? '').join('');
    expect(joined).toBe('B-analysis');

    // message_end
    const end = events[events.length - 1];
    expect(end.event).toBe('message_end');
    expect(end.data.type).toBe('swot');
    expect(end.data.modelUsed).toMatch(/^judge:/);

    // Persisted request + result
    expect(reqRepo.saved).toHaveLength(1);
    expect(reqRepo.saved[0].templateType).toBe('swot');
    expect(resRepo.saved).toHaveLength(1);
  });

  it('yields an error event when every provider fails', async () => {
    const failingA: LLMProvider = {
      name: 'kimi',
      // eslint-disable-next-line @typescript-eslint/require-await
      async chat(): Promise<ChatCompletionResult> {
        throw new LLMError(LLMErrorCode.SERVICE_ERROR, 'kimi', 'down', true);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async *chatStream(): AsyncIterable<{ content: string }> {
        // never used
      },
    };
    const failingB: LLMProvider = {
      name: 'deepseek',
      // eslint-disable-next-line @typescript-eslint/require-await
      async chat(): Promise<ChatCompletionResult> {
        throw new LLMError(LLMErrorCode.RATE_LIMIT, 'deepseek', 'rate', true);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async *chatStream(): AsyncIterable<{ content: string }> {
        // never used
      },
    };
    const { service } = makeService([failingA, failingB], '{}');

    const events = await collect(
      service.createStream('user-1', {
        query: 'topic',
        type: 'pros_cons',
      }),
    );

    // message_start, then a single error event. No message_end.
    expect(events[0].event).toBe('message_start');
    const last = events[events.length - 1];
    expect(last.event).toBe('error');
    expect(last.data.error?.code).toBe('ALL_PROVIDERS_FAILED');
  });

  it('throws BadRequestException for an unknown strategy type', async () => {
    const { service } = makeService([], '{}');
    await expect(
      collect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.createStream('user-1', { query: 'x', type: 'bogus' as any }),
      ),
    ).rejects.toThrow(/Unknown strategy type/);
  });
});
