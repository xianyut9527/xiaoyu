import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  CONVERSATIONS_ENDPOINT,
  CreateConversationDto,
  CreateConversationSchema,
  PaginatedConversations,
  PaginationQuery,
  PaginationQuerySchema,
} from '@xiaoyu/api-types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { User } from '../../../entities/user.entity';
import {
  DeviceIdAuthGuard,
  RequestWithUser,
} from '../../auth/guards/device-id.guard';
import { ConversationService } from '../services/conversation.service';

/**
 * ConversationController exposes the CRUD surface for chat
 * sessions. Every route is gated by DeviceIdAuthGuard, and the
 * `userId` is always read from `req.user.id` — never from the
 * request body or query string.
 *
 * The controller path mirrors the `CONVERSATIONS_ENDPOINT`
 * constant from `@xiaoyu/api-types`. NestJS does not accept a
 * function in the `@Controller` decorator, so we strip the global
 * `/api/v1` prefix here and let `main.ts` re-add it via
 * `setGlobalPrefix`.
 */
@Controller(CONVERSATIONS_ENDPOINT.replace(/^\/api\/v\d+\//, ''))
@UseGuards(DeviceIdAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateConversationSchema))
  async create(
    @Req() request: RequestWithUser,
    @Body() body: CreateConversationDto,
  ): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const user = this.requireUser(request);
    const conversation = await this.conversationService.create(
      user.id,
      body.title,
    );
    return this.toResponse(conversation);
  }

  @Get()
  @UsePipes(new ZodValidationPipe(PaginationQuerySchema))
  async findAll(
    @Req() request: RequestWithUser,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedConversations> {
    const user = this.requireUser(request);
    const page = await this.conversationService.findByUser(
      user.id,
      query.page,
      query.limit,
    );
    return {
      list: page.list.map((c) => this.toResponse(c)),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }

  @Get(':id')
  async findOne(
    @Req() request: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const user = this.requireUser(request);
    const conversation = await this.conversationService.findByIdAndUserOrThrow(
      id,
      user.id,
    );
    return this.toResponse(conversation);
  }

  @Patch(':id')
  async updateTitle(
    @Req() request: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { title: string },
  ): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const user = this.requireUser(request);
    const conversation = await this.conversationService.updateTitle(
      id,
      user.id,
      body.title,
    );
    return this.toResponse(conversation);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() request: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const user = this.requireUser(request);
    await this.conversationService.delete(id, user.id);
  }

  private requireUser(request: RequestWithUser): User {
    // The guard guarantees this, but the compiler does not know
    // that. We re-check defensively to keep strict mode happy.
    if (!request.user) {
      throw new Error('DeviceIdAuthGuard did not populate req.user');
    }
    return request.user;
  }

  private toResponse(conversation: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  }): { id: string; title: string; createdAt: string; updatedAt: string } {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }
}
