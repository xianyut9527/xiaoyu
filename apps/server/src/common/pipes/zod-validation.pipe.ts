import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Generic NestJS pipe that validates a request payload (body, query,
 * or params) against a Zod schema. Throws `BadRequestException` with
 * a structured Zod error list so clients can pinpoint which field
 * failed validation.
 *
 * The schema is provided at decoration time via
 * `@UsePipes(new ZodValidationPipe(MySchema))` or by extending this
 * class. We deliberately do NOT inject a global schema map here to
 * keep the contract explicit at each controller boundary.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request payload failed validation',
        details: this.formatErrors(parsed.error),
      });
    }
    return parsed.data;
  }

  private formatErrors(error: ZodError): Array<{
    path: string;
    message: string;
  }> {
    return error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
}
