import { Module } from '@nestjs/common';
import { RedditController } from './reddit/reddit.controller';
import { RedditCrawlerService } from './reddit/reddit-crawler.service';
import { RedditOutputService } from './reddit/reddit-output.service';
import { RedditSessionService } from './reddit/reddit-session.service';

@Module({
  controllers: [RedditController],
  providers: [
    RedditSessionService,
    RedditCrawlerService,
    RedditOutputService,
  ],
})
export class AppModule {}
