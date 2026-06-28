import { Module } from '@nestjs/common';
import { RedditController } from './reddit/reddit.controller';
import { RedditCrawlerService } from './reddit/reddit-crawler.service';
import { RedditOutputService } from './reddit/reddit-output.service';
import { RedditSessionService } from './reddit/reddit-session.service';

@Module({
  controllers: [RedditController],
  providers: [
    RedditSessionService,
    RedditOutputService,
    {
      provide: RedditCrawlerService,
      inject: [RedditSessionService, RedditOutputService],
      useFactory: (
        sessions: RedditSessionService,
        output: RedditOutputService,
      ): RedditCrawlerService => new RedditCrawlerService(sessions, output),
    },
  ],
})
export class AppModule {}
