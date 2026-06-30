import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { DeviceIdAuthGuard } from './guards/device-id.guard';
import { UserService } from './services/user.service';

/**
 * AuthModule owns the anonymous device-id authentication path for
 * U3. It registers `UserRepository` via TypeORM and exposes both
 * `UserService` and `DeviceIdAuthGuard` to the rest of the app.
 *
 * `UserService` is exported because ConversationService and
 * MessageService do not need it directly today, but other future
 * units (e.g. analysis request ownership checks) will. Exposing it
 * here keeps the dependency graph explicit.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserService, DeviceIdAuthGuard],
  exports: [UserService, DeviceIdAuthGuard],
})
export class AuthModule {}
