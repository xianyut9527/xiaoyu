import { z } from 'zod';

export const CreateConversationSchema = z.object({
  title: z.string().max(200).optional(),
});

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PaginatedConversationsSchema = z.object({
  list: z.array(ConversationSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type PaginatedConversations = z.infer<typeof PaginatedConversationsSchema>;
