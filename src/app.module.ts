import { Module } from '@nestjs/common';
import { RedditController } from './reddit/reddit.controller';
import { RedditCrawlerService } from './reddit/reddit-crawler.service';
import { RedditCrawlerV2Service } from './reddit/reddit-crawler-v2.service';
import { RedditOutputService } from './reddit/reddit-output.service';
import { RedditSessionService } from './reddit/reddit-session.service';
import { resolveRedditSourceUrl } from './reddit/reddit-source-url';
import { RedditSourceConfig } from './reddit/reddit.types';

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
      ) => {
        const crawler = new RedditCrawlerV2Service(sessions, output);
        const runtimeCrawler = crawler as unknown as {
          buildSourceUrl: (
            source: RedditSourceConfig,
            oldReddit: boolean,
          ) => string;
        };

        Object.defineProperty(runtimeCrawler, 'buildSourceUrl', {
          configurable: false,
          enumerable: false,
          writable: false,
          value: resolveRedditSourceUrl,
        });

        return crawler;
      },
    },
  ],
})
export class AppModule {}
