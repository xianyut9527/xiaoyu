import { z } from 'zod';

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(8192),
  conversationId: z.string().uuid().optional(),
  modelPreference: z.enum(['deepseek', 'kimi', 'glm']).optional(),
});

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.string().datetime(),
});

export const PaginatedMessagesSchema = z.object({
  list: z.array(ChatMessageSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type PaginatedMessages = z.infer<typeof PaginatedMessagesSchema>;
