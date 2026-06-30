import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SSEChunk,
  StrategyRequestDto,
  StrategyRequestSchema,
  StrategySSEData,
} from '@xiaoyu/api-types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { User } from '../../../entities/user.entity';
import {
  DeviceIdAuthGuard,
  RequestWithUser,
} from '../../auth/guards/device-id.guard';
import { AnalysisService } from '../services/analysis.service';
import { AnalysisTemplate } from '../templates/analysis-template';

/**
 * AnalysisController exposes the U7 surface:
 *
 *   - `GET  /analysis/templates`  – list the available strategy
 *     templates so the client can render the picker.
 *   - `POST /analysis`            – run an analysis and stream
 *     the structured result back as Server-Sent Events.
 *
 * Both routes are gated by `DeviceIdAuthGuard`, matching the
 * rest of the backend. The SSE route does NOT use the standard
 * Nest `@Body()` pipe directly because Express already consumed
 * the body before the controller can stream; the Zod validation
 * pipe is still applied for shape checks.
 */
@Controller('analysis')
@UseGuards(DeviceIdAuthGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('templates')
  listTemplates(): AnalysisTemplate[] {
    return this.analysisService.listTemplates();
  }

  @Post()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @UsePipes(new ZodValidationPipe(StrategyRequestSchema))
  async analyze(
    @Req() request: RequestWithUser,
    @Body() dto: StrategyRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const user = this.requireUser(request);

    // Flush headers immediately so the client knows the stream is
    // open. Express otherwise buffers the first chunk.
    res.flushHeaders?.();

    try {
      for await (const event of this.analysisService.createStream(
        user.id,
        dto,
      )) {
        res.write(this.formatSse(event));
      }
    } catch (err) {
      // The service should never throw — every error path is
      // converted to an `error` SSE event — but if it does we
      // emit a final generic error event so the client does not
      // see a broken connection.
      const message = err instanceof Error ? err.message : String(err);
      res.write(
        this.formatSse({
          event: 'error',
          data: {
            error: { code: 'STREAM_ERROR', message },
          },
        }),
      );
    } finally {
      res.end();
    }
  }

  private requireUser(request: RequestWithUser): User {
    if (!request.user) {
      throw new Error('DeviceIdAuthGuard did not populate req.user');
    }
    return request.user;
  }

  /**
   * Format a single SSE envelope. Each chunk is:
   *
   *   event: <name>
   *   data: <json>
   *   <blank line>
   *
   * The client parses `data` as JSON regardless of `event`.
   */
  private formatSse(event: SSEChunk<StrategySSEData>): string {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
  }
}
