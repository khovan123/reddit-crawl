import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function configurePlaywrightMode(): boolean {
  const showBrowser = isEnabled(process.env.REDDIT_SHOW_BROWSER);

  // Both crawler implementations currently read REDDIT_HEADLESS. Normalize it
  // once during application startup so existing local .env files cannot
  // accidentally keep opening visible browser windows after this update.
  process.env.REDDIT_HEADLESS = showBrowser ? 'false' : 'true';
  return !showBrowser;
}

async function bootstrap(): Promise<void> {
  const headless = configurePlaywrightMode();
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
  console.log(
    headless
      ? 'Playwright mode: background (headless)'
      : 'Playwright mode: visible browser (debug)',
  );
}

void bootstrap();
