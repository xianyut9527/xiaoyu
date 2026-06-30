import { StrategyResponse, StrategyType } from '@xiaoyu/api-types';

/**
 * FormField describes a single input control rendered by the
 * client UI. The shape is intentionally tiny so the client can
 * map it to native form widgets without a runtime dependency on
 * the server.
 */
export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  required?: boolean;
  placeholder?: string;
}

/**
 * AnalysisTemplate is the contract every strategy template
 * (SWOT / decision tree / pros-cons) must satisfy.
 *
 *   - `buildPrompt` converts the user input into a model prompt.
 *   - `parseOutput` converts the raw model response (a string) into
 *     a structured `StrategyResponse` that the client can render.
 *
 * The template is intentionally a pure object (no NestJS DI
 * dependencies) so it can be unit-tested in isolation and reused
 * outside the HTTP layer (e.g. by background jobs in a later
 * milestone).
 */
export interface AnalysisTemplate {
  id: StrategyType;
  name: string;
  description: string;
  icon: string;
  formSchema: FormField[];
  buildPrompt(input: Record<string, unknown>): string;
  parseOutput(content: string): StrategyResponse;
}
