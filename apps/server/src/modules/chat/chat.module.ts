import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../../entities/conversation.entity';
import { Message } from '../../entities/message.entity';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './controllers/chat.controller';
import { ConversationController } from './controllers/conversation.controller';
import { MessageController } from './controllers/message.controller';
import { ChatService } from './services/chat.service';
import { ContextService } from './services/context.service';
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';

/**
 * ChatModule groups the chat surface:
 *   - U3: ConversationService, MessageService, ContextService and
 *     the per-resource REST controllers.
 *   - U6: ChatService and ChatController — the streaming chat
 *     endpoint.
 *
 * AuthModule is imported for the DeviceIdAuthGuard. LLMModule is
 * a global module (registered in AppModule) so ChatService can
 * inject the LLM services without an explicit import.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message]), AuthModule],
  controllers: [
    ConversationController,
    MessageController,
    ChatController,
  ],
  providers: [
    ConversationService,
    MessageService,
    ContextService,
    ChatService,
  ],
  exports: [
    ConversationService,
    MessageService,
    ContextService,
    ChatService,
  ],
})
export class ChatModule {}
