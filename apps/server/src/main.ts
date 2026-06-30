import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { API_VERSION } from '@xiaoyu/api-types';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.setGlobalPrefix(API_VERSION.replace(/^\//, ''));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`Server running on http://localhost:${port}${API_VERSION}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
