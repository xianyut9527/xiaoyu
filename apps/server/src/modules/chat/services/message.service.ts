import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../../../entities/conversation.entity';
import { Message, MessageRole } from '../../../entities/message.entity';
import { ConversationService } from './conversation.service';

export interface PaginatedMessages {
  list: Message[];
  total: number;
  page: number;
  limit: number;
}

export const MAX_MESSAGE_CONTENT_LENGTH = 8192;

/**
 * MessageService owns the message log of every conversation. U3 only
 * requires persistence + retrieval: the LLM-streaming unit (U6) will
 * orchestrate calls to `create` for both user and assistant turns.
 *
 * Authorization policy: any write to a conversation first checks
 * ownership via ConversationService. The check is centralized here
 * so U6 cannot accidentally append to someone else's conversation.
 */
@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Persists a new message in a conversation owned by `userId`.
   * The DB-side cap on `content` is `text` (unbounded), but we
   * enforce the api-types `SendMessageSchema` cap of 8192 chars at
   * the service boundary as well so non-HTTP callers (e.g. jobs)
   * get the same guarantee.
   */
  async create(
    conversationId: string,
    userId: string,
    role: MessageRole,
    content: string,
  ): Promise<Message> {
    if (!content || content.length === 0) {
      throw new NotFoundException('Message content must not be empty');
    }
    if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      throw new NotFoundException(
        `Message content exceeds ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
      );
    }

    // Confirms the conversation exists AND belongs to the caller.
    // Throws NotFoundException on either failure.
    await this.conversationService.findByIdAndUserOrThrow(
      conversationId,
      userId,
    );

    const message = this.messageRepository.create({
      conversationId,
      role,
      content,
    });
    return this.messageRepository.save(message);
  }

  /**
   * Returns a single page of the conversation history, newest
   * first. The caller is expected to have already authorized access
   * to the conversation; we still pass `userId` to keep the service
   * self-defending.
   */
  async findByConversation(
    conversationId: string,
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedMessages> {
    await this.conversationService.findByIdAndUserOrThrow(
      conversationId,
      userId,
    );

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));

    const [list, total] = await this.messageRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { list, total, page: safePage, limit: safeLimit };
  }

  /**
   * Returns the most recent N messages of a conversation in
   * chronological order (oldest first). This is the "context
   * window" that gets fed to the LLM. Server-side truncation is
   * authoritative: the client never decides how many messages the
   * model sees.
   */
  async getRecentContext(
    conversationId: string,
    userId: string,
    maxMessages = 20,
  ): Promise<Message[]> {
    await this.conversationService.findByIdAndUserOrThrow(
      conversationId,
      userId,
    );

    const safeMax = Math.max(1, Math.floor(maxMessages) || 20);

    // Fetch the latest `safeMax` rows ordered DESC, then reverse
    // in-memory to oldest-first. Doing the reversal in app code
    // avoids depending on dialect-specific OFFSET behavior with
    // ORDER BY ASC + LIMIT.
    const recentDesc = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: safeMax,
    });

    return recentDesc.reverse();
  }
}
