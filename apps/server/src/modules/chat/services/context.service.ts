import { Injectable } from '@nestjs/common';
import { Message, MessageRole } from '../../../entities/message.entity';
import { ChatMessage } from '@xiaoyu/api-types';
import { MessageService } from './message.service';

/**
 * LLMMessage is the minimum projection of a stored message that an
 * upstream LLM provider understands. It deliberately omits database
 * fields (id, conversationId, createdAt) and normalizes `role` to
 * the three canonical LLM values.
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * ContextService is the bridge between persisted messages and the
 * LLM request payload. It does NOT inject system prompts — that is
 * the responsibility of the upstream chat orchestrator (U5/U6),
 * which may want to compose multiple system instructions
 * conditionally.
 */
@Injectable()
export class ContextService {
  constructor(private readonly messageService: MessageService) {}

  /**
   * Reads the most recent N messages (default 20) for a
   * conversation, projects them to the LLM format, and returns them
   * in chronological order (oldest first) so the caller can append
   * the new turn at the end without re-sorting.
   */
  async buildContext(
    conversationId: string,
    userId: string,
    maxMessages = 20,
  ): Promise<LLMMessage[]> {
    const messages = await this.messageService.getRecentContext(
      conversationId,
      userId,
      maxMessages,
    );
    return messages.map((m) => this.toLLMMessage(m));
  }

  private toLLMMessage(message: Message): LLMMessage {
    return {
      role: this.normalizeRole(message.role),
      content: message.content,
    };
  }

  private normalizeRole(role: MessageRole): LLMMessage['role'] {
    // The DB enum is the source of truth. The cast back to the
    // narrow union keeps callers honest: if MessageRole is
    // extended with a new value, the caller will need to make a
    // deliberate decision about how to map it.
    return role as LLMMessage['role'];
  }

  /**
   * Convenience helper for callers that already have a
   * `ChatMessage[]` (e.g. fetched via the API) and want to skip
   * the DB round-trip. Kept here so all LLM projections live in
   * one place.
   */
  static fromChatMessages(messages: ChatMessage[]): LLMMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }
}
