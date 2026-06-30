import { StrategyResponse } from '@xiaoyu/api-types';
import { buildSwotPrompt } from '../../llm/prompts/strategy/swot.prompt';
import { AnalysisTemplate } from './analysis-template';
import { tryParseStructured } from './parse-utils';

/**
 * SWOT analysis template.
 *
 * Renders a single-topic SWOT prompt and parses the model's
 * response into a structured `StrategyResponse`. The structured
 * shape (`strengths` / `weaknesses` / `opportunities` / `threats`
 * arrays) is preserved verbatim so the client UI can render the
 * classic 2x2 grid.
 */
export const SwotTemplate: AnalysisTemplate = {
  id: 'swot',
  name: 'SWOT 分析',
  description: '分析优势、劣势、机会与威胁',
  icon: '📊',
  formSchema: [
    {
      key: 'topic',
      label: '分析主题',
      type: 'textarea',
      required: true,
      placeholder: '请输入要分析的主题，例如：是否进入东南亚市场',
    },
    {
      key: 'context',
      label: '背景信息（可选）',
      type: 'textarea',
      required: false,
      placeholder: '可补充行业、时间范围、关键约束等',
    },
  ],
  buildPrompt(input: Record<string, unknown>): string {
    const topic = String(input.topic ?? '').trim();
    if (!topic) {
      // U7 invariant: the DTO already requires `query` (min 1 char).
      // The empty-topic branch keeps the contract forgiving when
      // templates are exercised in isolation.
      return buildSwotPrompt('');
    }
    const context = String(input.context ?? '').trim();
    const combined = context ? `${topic}\n\nBackground: ${context}` : topic;
    return buildSwotPrompt(combined);
  },
  parseOutput(content: string): StrategyResponse {
    const structured = tryParseStructured(content);
    const analysis =
      typeof structured?.analysis === 'string' && structured.analysis.length > 0
        ? structured.analysis
        : content;
    return {
      type: 'swot',
      analysis,
      structured: structured ?? {},
      modelUsed: 'multi',
    };
  },
};
