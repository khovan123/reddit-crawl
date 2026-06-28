import { z } from 'zod';

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().default('/'),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']),
  session: z.boolean(),
  expirationDate: z.number().optional(),
  partitionKey: z.string().optional(),
});

export const sessionSnapshotSchema = z.object({
  leaseId: z.string().min(1),
  issuedAt: z.string().min(1),
  sourceUrl: z.string().url(),
  cookieStoreId: z.string().min(1),
  incognito: z.boolean(),
  browser: z.object({
    userAgent: z.string().min(1),
    locale: z.string().min(1),
    timezone: z.string().min(1),
    viewport: z.object({
      width: z.number().int().min(320).max(7680),
      height: z.number().int().min(240).max(4320),
      deviceScaleFactor: z.number().min(0.5).max(4),
    }),
  }),
  cookies: z.array(cookieSchema).min(1).max(1000),
  localStorage: z.record(z.string(), z.string()).optional(),
});

const sourceSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum([
      'HOME',
      'FOR_YOU',
      'FOLLOWING',
      'POPULAR',
      'NEWS',
      'BEST',
      'SUBREDDIT',
      'CUSTOM_URL',
    ]),
    subreddit: z.string().trim().min(1).max(100).optional(),
    url: z.string().url().optional(),
    sort: z.enum(['BEST', 'HOT', 'NEW', 'TOP', 'RISING']).optional(),
    timeRange: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'ALL']).optional(),
    targetPostCount: z.number().int().min(1).max(2000),
    includePromoted: z.boolean().optional(),
    includePinned: z.boolean().optional(),
    includeNsfw: z.boolean().optional(),
    maxScrolls: z.number().int().min(1).max(1000).optional(),
    maxStallRounds: z.number().int().min(1).max(30).optional(),
  })
  .superRefine((source, context) => {
    if (source.type === 'SUBREDDIT' && !source.subreddit) {
      context.addIssue({
        code: 'custom',
        message: 'subreddit is required for SUBREDDIT source',
        path: ['subreddit'],
      });
    }

    if (source.type === 'CUSTOM_URL') {
      if (!source.url) {
        context.addIssue({
          code: 'custom',
          message: 'url is required for CUSTOM_URL source',
          path: ['url'],
        });
        return;
      }

      const url = new URL(source.url);
      const hostname = url.hostname;
      if (hostname !== 'reddit.com' && !hostname.endsWith('.reddit.com')) {
        context.addIssue({
          code: 'custom',
          message: 'CUSTOM_URL must point to reddit.com',
          path: ['url'],
        });
      }

      if (url.pathname.replace(/\/+$/, '').toLowerCase() === '/latest') {
        context.addIssue({
          code: 'custom',
          message: 'The Reddit /latest source has been removed',
          path: ['url'],
        });
      }
    }
  });

export const crawlConfigSchema = z.object({
  sources: z.array(sourceSchema).min(1).max(100),
  detail: z
    .object({
      enabled: z.boolean().optional(),
      maxParallelTabs: z.number().int().min(1).max(4).optional(),
      commentsTopN: z.number().int().min(0).max(50).optional(),
    })
    .optional(),
});
