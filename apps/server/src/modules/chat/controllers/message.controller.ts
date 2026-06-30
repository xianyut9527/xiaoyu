import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ChatMessage,
  CONVERSATIONS_ENDPOINT,
  PaginatedMessages,
  PaginationQuery,
  PaginationQuerySchema,
  SendMessageDto,
  SendMessageSchema,
} from '@xiaoyu/api-types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { User } from '../../../entities/user.entity';
import { MessageRole } from '../../../entities/message.entity';
import {
  DeviceIdAuthGuard,
  RequestWithUser,
} from '../../auth/guards/device-id.guard';
import { MessageService } from '../services/message.service';

/**
 * MessageController exposes the per-conversation message log.
 * The path mirrors the `MESSAGES_ENDPOINT` constant from
 * `@xiaoyu/api-types`. We cannot pass the function to the
 * `@Controller` decorator (it expects a string literal), so we
 * build the same path string from the constant.
 *
 * NestJS does not accept a function in the `@Controller` decorator,
 * so we strip the global `/api/v1` prefix here and let `main.ts`
 * re-add it via `setGlobalPrefix`.
 */
const MESSAGES_CONTROLLER_PATH = `${CONVERSATIONS_ENDPOINT.replace(/^\/api\/v\d+\//, '')}/:conversationId/messages`;

@Controller(MESSAGES_CONTROLLER_PATH)
@UseGuards(DeviceIdAuthGuard)
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  /**
   * Persists a new user message. U3 deliberately does NOT trigger
   * an LLM call here — that is the job of U6, which will append
   * the assistant turn after the streaming response finishes.
   * Accepting the message here lets clients post the user turn
   * before the stream is opened, which matches the protocol the
   * client team has been building against.
   */
  @Post()
  @UsePipes(new ZodValidationPipe(SendMessageSchema))
  async create(
    @Req() request: RequestWithUser,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: SendMessageDto,
  ): Promise<ChatMessage> {
    const user = this.requireUser(request);
    // The `conversationId` in the URL is authoritative. If a
    // body-level `conversationId` is provided, we still ignore it
    // to prevent ambiguity.
    void body.conversationId;

    const message = await this.messageService.create(
      conversationId,
      user.id,
      MessageRole.User,
      body.content,
    );
    return this.toResponse(message);
  }

  @Get()
  @UsePipes(new ZodValidationPipe(PaginationQuerySchema))
  async findAll(
    @Req() request: RequestWithUser,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedMessages> {
    const user = this.requireUser(request);
    const page = await this.messageService.findByConversation(
      conversationId,
      user.id,
      query.page,
      query.limit,
    );
    return {
      list: page.list.map((m) => this.toResponse(m)),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }

  private requireUser(request: RequestWithUser): User {
    if (!request.user) {
      throw new Error('DeviceIdAuthGuard did not populate req.user');
    }
    return request.user;
  }

  private toResponse(message: {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: Date;
  }): ChatMessage {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
