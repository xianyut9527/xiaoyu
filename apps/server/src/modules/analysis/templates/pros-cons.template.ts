import { StrategyResponse } from '@xiaoyu/api-types';
import { buildProsConsPrompt } from '../../llm/prompts/strategy/pros-cons.prompt';
import { AnalysisTemplate } from './analysis-template';
import { tryParseStructured } from './parse-utils';

/**
 * Pros/Cons analysis template.
 *
 * Produces a balanced list of advantages and disadvantages plus
 * a short overall judgement string.
 */
export const ProsConsTemplate: AnalysisTemplate = {
  id: 'pros_cons',
  name: '利弊分析',
  description: '并列呈现方案的优点与缺点',
  icon: '⚖️',
  formSchema: [
    {
      key: 'topic',
      label: '待评估方案',
      type: 'textarea',
      required: true,
      placeholder: '请输入要评估的方案或决定',
    },
    {
      key: 'context',
      label: '背景信息（可选）',
      type: 'textarea',
      required: false,
      placeholder: '可补充当前处境、关键人物等',
    },
  ],
  buildPrompt(input: Record<string, unknown>): string {
    const topic = String(input.topic ?? '').trim();
    const context = String(input.context ?? '').trim();
    const combined = context ? `${topic}\n\nBackground: ${context}` : topic;
    return buildProsConsPrompt(combined);
  },
  parseOutput(content: string): StrategyResponse {
    const structured = tryParseStructured(content);
    const analysis =
      typeof structured?.analysis === 'string' && structured.analysis.length > 0
        ? structured.analysis
        : content;
    return {
      type: 'pros_cons',
      analysis,
      structured: structured ?? {},
      modelUsed: 'multi',
    };
  },
};
