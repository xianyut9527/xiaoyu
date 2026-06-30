import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../../../entities/conversation.entity';

export interface PaginatedConversations {
  list: Conversation[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ConversationService is the source of truth for chat session
 * metadata. It enforces user-level isolation: every public method
 * takes a `userId` and scopes reads/writes to that user. Cross-user
 * access always raises `NotFoundException` (never `Forbidden`) to
 * avoid leaking the existence of other users' conversations.
 */
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  /**
   * Creates a new conversation owned by `userId`. The default
   * `title` is the column default `'新会话'`, but a custom title can
   * be passed in. The DB default is intentionally not re-implemented
   * here so that a caller that passes `undefined` falls through to
   * the entity's `default`.
   */
  async create(userId: string, title?: string): Promise<Conversation> {
    const conversation = this.conversationRepository.create({
      userId,
      title: title ?? '新会话',
    });
    return this.conversationRepository.save(conversation);
  }

  /**
   * Returns a paginated list of the user's conversations, newest
   * first. The `limit` clamp is applied here (and not in the
   * controller) so that the service is safe to call from other
   * call sites such as background jobs.
   */
  async findByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedConversations> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));

    const [list, total] = await this.conversationRepository.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { list, total, page: safePage, limit: safeLimit };
  }

  /**
   * Looks up a single conversation, but only if it belongs to
   * `userId`. A conversation belonging to another user is reported
   * as "not found" to avoid authorization side channels.
   */
  async findByIdAndUser(
    id: string,
    userId: string,
  ): Promise<Conversation | null> {
    if (!id) {
      return null;
    }
    return this.conversationRepository.findOne({ where: { id, userId } });
  }

  /**
   * Helper that throws when the conversation does not exist for the
   * given user. Used by other services that need a hard error
   * (e.g. message creation must fail loudly on unknown IDs).
   */
  async findByIdAndUserOrThrow(
    id: string,
    userId: string,
  ): Promise<Conversation> {
    const conversation = await this.findByIdAndUser(id, userId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  /**
   * Renames a conversation. Only the owner can rename; cross-user
   * access is reported as `NotFoundException` for the same reason as
   * `findByIdAndUser`.
   */
  async updateTitle(
    id: string,
    userId: string,
    title: string,
  ): Promise<Conversation> {
    const conversation = await this.findByIdAndUserOrThrow(id, userId);
    conversation.title = title;
    return this.conversationRepository.save(conversation);
  }

  /**
   * Hard-deletes a conversation. CASCADE on the FK ensures that
   * child messages are removed in the same transaction. A missing or
   * cross-user id both surface as `NotFoundException`.
   */
  async delete(id: string, userId: string): Promise<void> {
    const conversation = await this.findByIdAndUserOrThrow(id, userId);
    await this.conversationRepository.remove(conversation);
  }
}
