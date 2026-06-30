import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisRequest } from '../../entities/analysis-request.entity';
import { AnalysisResult } from '../../entities/analysis-result.entity';
import { AuthModule } from '../auth/auth.module';
import { AnalysisController } from './controllers/analysis.controller';
import { AnalysisService } from './services/analysis.service';

/**
 * AnalysisModule is the U7 surface.
 *
 * It depends on:
 *   - `TypeOrmModule.forFeature([AnalysisRequest, AnalysisResult])`
 *     to obtain the request/result repositories.
 *   - `AuthModule` so `DeviceIdAuthGuard` (which is registered
 *     there) can resolve the `UserService` it needs.
 *
 * `LLMModule` is registered as `@Global`, so we do not need to
 * import it explicitly to use `ParallelLLMService` or
 * `JudgeService`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisRequest, AnalysisResult]),
    AuthModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
