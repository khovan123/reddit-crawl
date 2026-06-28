export type RedditSourceType =
  | 'HOME'
  | 'FOR_YOU'
  | 'FOLLOWING'
  | 'POPULAR'
  | 'NEWS'
  | 'BEST'
  | 'LATEST'
  | 'SUBREDDIT'
  | 'CUSTOM_URL';

export type RedditSort = 'BEST' | 'HOT' | 'NEW' | 'TOP' | 'RISING';
export type RedditTimeRange = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

export interface BrowserCookieSnapshot {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  session: boolean;
  expirationDate?: number;
  partitionKey?: string;
}

export interface RedditSessionSnapshot {
  leaseId: string;
  issuedAt: string;
  sourceUrl: string;
  cookieStoreId: string;
  incognito: boolean;
  browser: {
    userAgent: string;
    locale: string;
    timezone: string;
    viewport: {
      width: number;
      height: number;
      deviceScaleFactor: number;
    };
  };
  cookies: BrowserCookieSnapshot[];
  localStorage?: Record<string, string>;
}

export interface RedditSourceConfig {
  id?: string;
  type: RedditSourceType;
  subreddit?: string;
  url?: string;
  sort?: RedditSort;
  timeRange?: RedditTimeRange;
  targetPostCount: number;
  includePromoted?: boolean;
  includePinned?: boolean;
  includeNsfw?: boolean;
  maxScrolls?: number;
  maxStallRounds?: number;
}

export interface RedditCrawlConfig {
  sources: RedditSourceConfig[];
  detail?: {
    enabled?: boolean;
    maxParallelTabs?: number;
    commentsTopN?: number;
  };
}

export interface RedditMedia {
  type: 'IMAGE' | 'GALLERY_IMAGE' | 'VIDEO_POSTER' | 'THUMBNAIL';
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  order: number;
}

export interface RedditComment {
  id?: string;
  author?: string;
  body: string;
  score?: number;
  permalink?: string;
}

export interface RedditPostPlacement {
  sourceId: string;
  sourceType: RedditSourceType;
  sourceUrl: string;
  rank: number;
  scrollRound: number;
  capturedAt: string;
}

export interface RedditPostRecord {
  id: string;
  canonicalUrl: string;
  author?: string;
  authorProfileUrl?: string;
  subreddit?: string;
  subredditUrl?: string;
  title: string;
  content?: string;
  summary?: string;
  summaryType: 'excerpt';
  externalUrl?: string;
  postType: string;
  media: RedditMedia[];
  score?: number;
  scoreHidden: boolean;
  likeCount: null;
  viewerVote?: 'UP' | 'DOWN' | 'NONE';
  commentCount?: number;
  createdAt?: string;
  flags: {
    promoted: boolean;
    pinned: boolean;
    locked: boolean;
    spoiler: boolean;
    nsfw: boolean;
    deleted: boolean;
    removed: boolean;
  };
  comments: RedditComment[];
  placements: RedditPostPlacement[];
  capturedAt: string;
  completeness: 'CARD' | 'FULL' | 'PARTIAL';
}

export type CrawlJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export interface CrawlSourceProgress {
  sourceId: string;
  sourceType: RedditSourceType;
  requested: number;
  collected: number;
  scrollRound: number;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED';
  message?: string;
}

export interface CrawlJobState {
  jobId: string;
  status: CrawlJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  outputFile?: string;
  latestOutputFile?: string;
  error?: string;
  sources: CrawlSourceProgress[];
}

export interface CrawlOutput {
  version: 1;
  jobId: string;
  startedAt: string;
  completedAt: string;
  status: 'COMPLETED' | 'PARTIAL';
  stats: {
    requestedPosts: number;
    uniquePosts: number;
    sourceCount: number;
  };
  sources: CrawlSourceProgress[];
  posts: RedditPostRecord[];
}
