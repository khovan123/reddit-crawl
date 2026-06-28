import { RedditSourceConfig } from './reddit.types';

export function resolveRedditSourceUrl(
  source: RedditSourceConfig,
  oldReddit = false,
): string {
  const host = oldReddit ? 'old.reddit.com' : 'www.reddit.com';
  const sort = source.sort?.toLowerCase();
  const timeRange = source.timeRange?.toLowerCase();

  switch (source.type) {
    case 'HOME':
    case 'FOR_YOU':
    case 'FOLLOWING':
      return `https://${host}/`;

    case 'POPULAR':
      return `https://${host}/r/popular/`;

    case 'NEWS':
      return `https://${host}/news/`;

    case 'BEST':
      return `https://${host}/posts/${new Date().getUTCFullYear()}/global/`;

    case 'LATEST':
      return `https://${host}/latest/`;

    case 'SUBREDDIT': {
      const subreddit = source.subreddit?.trim().replace(/^r\//i, '');
      const url = new URL(
        `https://${host}/r/${encodeURIComponent(subreddit ?? '')}/${sort ?? 'hot'}/`,
      );

      if (source.sort === 'TOP' && timeRange) {
        url.searchParams.set('t', timeRange);
      }

      return url.href;
    }

    case 'CUSTOM_URL':
      return source.url!;

    default:
      return `https://${host}/`;
  }
}
