import { StrategyResponse } from '@xiaoyu/api-types';
import { buildDecisionTreePrompt } from '../../llm/prompts/strategy/decision-tree.prompt';
import { AnalysisTemplate } from './analysis-template';
import { tryParseStructured } from './parse-utils';

/**
 * Decision-tree analysis template.
 *
 * Produces a shallow decision tree (`branches` array) with a
 * rationale string. The client UI renders each branch as a node
 * and `options` as clickable children.
 */
export const DecisionTreeTemplate: AnalysisTemplate = {
  id: 'decision_tree',
  name: '决策树',
  description: '逐层拆解决策路径与各分支结果',
  icon: '🌳',
  formSchema: [
    {
      key: 'topic',
      label: '决策主题',
      type: 'textarea',
      required: true,
      placeholder: '请输入待决策的问题',
    },
    {
      key: 'context',
      label: '约束条件（可选）',
      type: 'textarea',
      required: false,
      placeholder: '可补充预算、时间、关键约束等',
    },
  ],
  buildPrompt(input: Record<string, unknown>): string {
    const topic = String(input.topic ?? '').trim();
    const context = String(input.context ?? '').trim();
    const combined = context ? `${topic}\n\nContext: ${context}` : topic;
    return buildDecisionTreePrompt(combined);
  },
  parseOutput(content: string): StrategyResponse {
    const structured = tryParseStructured(content);
    const analysis =
      typeof structured?.analysis === 'string' && structured.analysis.length > 0
        ? structured.analysis
        : content;
    return {
      type: 'decision_tree',
      analysis,
      structured: structured ?? {},
      modelUsed: 'multi',
    };
  },
};
