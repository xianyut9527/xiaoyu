import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { AnalysisRequest } from '../entities/analysis-request.entity';
import { AnalysisResult } from '../entities/analysis-result.entity';

// Load environment from the monorepo root .env when this file is
// executed outside of the NestJS context (e.g. via the typeorm CLI).
// In NestJS startup, ConfigModule.forRoot has already loaded the
// file, so this is effectively a no-op.
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const isDev = process.env.NODE_ENV === 'development';

/**
 * TypeORM DataSource used by both:
 *  - the NestJS app at boot (via TypeOrmModule.forRootAsync in app.module.ts)
 *  - the typeorm CLI for `migration:run` / `migration:revert`
 *
 * Entities and migrations paths are relative to the CWD (apps/server)
 * and point to the compiled output in `dist/`. Run `pnpm --filter
 * @xiaoyu/server build` before running migrations.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
  logging: isDev,
  // `migrationsRun` is intentionally left off so the app does not
  // implicitly migrate on boot; migrations are an explicit operator
  // action handled by the CLI.
});

// Required by the typeorm-ts-node-commonjs CLI loader.
export default AppDataSource;
