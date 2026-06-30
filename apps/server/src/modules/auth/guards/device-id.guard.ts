import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { User } from '../../../entities/user.entity';
import { UserService } from '../services/user.service';

/**
 * The shape of the request object that DeviceIdAuthGuard expects
 * to operate on. The guard's job is to populate `user` before the
 * controller runs, so the same shape is exported for downstream
 * code to consume.
 */
export interface RequestWithUser extends Request {
  user: User;
}

/**
 * DeviceIdAuthGuard is the single authentication gate for the U3
 * surface. The protocol is intentionally minimal:
 *
 *   - Every request MUST carry an `X-Device-ID` header.
 *   - The header is treated as the unique identifier of the device.
 *   - The guard resolves (or lazily creates) a User row and
 *     attaches it to `req.user`.
 *
 * The guard is NOT responsible for authorization (which is a
 * per-resource concern handled inside services). It only ensures
 * `req.user` is always populated for downstream code.
 */
@Injectable()
export class DeviceIdAuthGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawHeader = request.headers['x-device-id'];

    // `headers` values are typed as `string | string[] | undefined`.
    // We only accept a single string for now; multi-value headers
    // are treated as malformed and rejected to keep behavior
    // deterministic across clients.
    if (!rawHeader || typeof rawHeader !== 'string') {
      throw new UnauthorizedException('Missing X-Device-ID header');
    }

    const deviceId = rawHeader.trim();
    if (deviceId.length === 0) {
      throw new UnauthorizedException('Missing X-Device-ID header');
    }

    const user = await this.userService.findOrCreateByDeviceId(deviceId);
    // Cast to the augmented request type so the assignment compiles
    // without a global module augmentation (which would require
    // importing `express-serve-static-core` types in the entry tsconfig).
    (request as RequestWithUser).user = user;
    return true;
  }
}
