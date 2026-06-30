import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { LLMModule } from './modules/llm/llm.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { User } from './entities/user.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { AnalysisRequest } from './entities/analysis-request.entity';
import { AnalysisResult } from './entities/analysis-result.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, Conversation, Message, AnalysisRequest, AnalysisResult],
        synchronize: false,
        // Fail fast during local dev when Postgres is not running.
        retryAttempts: 0,
      }),
    }),
    LLMModule,
    AuthModule,
    ChatModule,
    AnalysisModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
