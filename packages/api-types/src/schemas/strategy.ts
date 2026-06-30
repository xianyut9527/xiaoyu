import { z } from 'zod';

export const StrategyTypeSchema = z.enum(['swot', 'decision_tree', 'pros_cons']);

export const StrategyRequestSchema = z.object({
  query: z.string().min(1).max(4096),
  type: StrategyTypeSchema,
  context: z.string().max(8192).optional(),
});

export const StrategyResponseSchema = z.object({
  type: StrategyTypeSchema,
  analysis: z.string(),
  structured: z.record(z.any()),
  modelUsed: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export type StrategyType = z.infer<typeof StrategyTypeSchema>;
export type StrategyRequestDto = z.infer<typeof StrategyRequestSchema>;
export type StrategyResponse = z.infer<typeof StrategyResponseSchema>;
