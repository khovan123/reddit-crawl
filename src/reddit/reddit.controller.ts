import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { RedditCrawlerService } from './reddit-crawler.service';
import { RedditSessionService } from './reddit-session.service';
import { RedditCrawlConfig, RedditSessionSnapshot } from './reddit.types';
import { crawlConfigSchema, sessionSnapshotSchema } from './reddit.validation';

@Controller('api/reddit')
export class RedditController {
  constructor(
    @Inject(RedditSessionService)
    private readonly sessions: RedditSessionService,
    @Inject(RedditCrawlerService)
    private readonly crawler: RedditCrawlerService,
  ) {}

  @Get('health')
  health(): { ok: true; timestamp: string } {
    return { ok: true, timestamp: new Date().toISOString() };
  }

  @Post('session')
  @HttpCode(200)
  connectSession(@Body() body: unknown): {
    connected: true;
    issuedAt: string;
    cookieCount: number;
  } {
    const parsed = sessionSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const snapshot = parsed.data as RedditSessionSnapshot;
    this.sessions.set(snapshot);

    return {
      connected: true,
      issuedAt: snapshot.issuedAt,
      cookieCount: snapshot.cookies.length,
    };
  }

  @Get('session')
  sessionStatus(): ReturnType<RedditSessionService['getStatus']> {
    return this.sessions.getStatus();
  }

  @Post('session/clear')
  @HttpCode(204)
  clearSession(): void {
    this.sessions.clear();
  }

  @Post('crawl')
  startCrawl(@Body() body: unknown) {
    const parsed = crawlConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    return this.crawler.start(parsed.data as RedditCrawlConfig);
  }

  @Get('crawl')
  listJobs() {
    return this.crawler.listJobs();
  }

  @Get('crawl/:jobId')
  getJob(@Param('jobId') jobId: string) {
    return this.crawler.getJob(jobId);
  }

  @Post('crawl/:jobId/cancel')
  cancelJob(@Param('jobId') jobId: string) {
    return this.crawler.cancel(jobId);
  }
}
