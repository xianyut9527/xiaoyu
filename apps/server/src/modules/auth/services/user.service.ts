import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/user.entity';

/**
 * UserService is the only entry point for resolving the currently
 * authenticated principal. U3 currently only supports anonymous
 * device-id based identification (U4 will introduce real auth).
 *
 * Important: `findOrCreateByDeviceId` does a `findOne` followed by a
 * `save` in two separate statements. PostgreSQL's UNIQUE constraint
 * on `users.device_id` makes the race benign: a concurrent save will
 * raise a duplicate-key error, which the caller can either ignore
 * (and retry the read) or surface as a 5xx. We accept this trade-off
 * because the deviceId is stable per device and contention in this
 * MVP is expected to be very low.
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Returns an existing user for the given deviceId, or creates a
   * new anonymous user row. The persisted row is what gets attached
   * to `req.user` for downstream controllers/services.
   */
  async findOrCreateByDeviceId(deviceId: string): Promise<User> {
    if (!deviceId || deviceId.length === 0) {
      throw new NotFoundException('deviceId must be a non-empty string');
    }

    const existing = await this.userRepository.findOne({
      where: { deviceId },
    });
    if (existing) {
      return existing;
    }

    const created = this.userRepository.create({ deviceId });
    return this.userRepository.save(created);
  }

  /**
   * Looks up a user by primary key. Returns `null` when not found so
   * callers can decide whether absence is an error.
   */
  async findById(id: string): Promise<User | null> {
    if (!id) {
      return null;
    }
    return this.userRepository.findOne({ where: { id } });
  }
}
