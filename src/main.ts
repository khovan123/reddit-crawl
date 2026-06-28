import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: false,
  });

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (
        !origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://') ||
        origin === 'http://127.0.0.1' ||
        origin === 'http://localhost'
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin is not allowed: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Local-Client'],
  });

  const port = Number(process.env.PORT ?? 47831);
  await app.listen(port, '127.0.0.1');

  console.log(`Reddit crawler backend: http://127.0.0.1:${port}`);
}

void bootstrap();
