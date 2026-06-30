import { AnalysisRequest } from './analysis-request.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

/**
 * User auth methods supported by the platform.
 * Stored as a varchar in the database to allow future values
 * without requiring a schema migration.
 */
export enum UserAuthType {
  Anonymous = 'anonymous',
  Email = 'email',
}

/**
 * The `users` table stores a unique record per device (anonymous)
 * or per email (after upgrading to a real account).
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  deviceId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: UserAuthType.Anonymous,
  })
  authType!: UserAuthType;

  /**
   * Email is optional: only set once the anonymous user upgrades
   * to an email-backed account. PostgreSQL allows multiple NULLs
   * inside a UNIQUE constraint, so this is safe.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Conversation, (conversation) => conversation.user)
  conversations?: Conversation[];

  @OneToMany(() => AnalysisRequest, (analysisRequest) => analysisRequest.user)
  analysisRequests?: AnalysisRequest[];
}
