import type { Page } from 'playwright';
import type {
  RedditCrawlConfig,
  RedditMedia,
  RedditPostRecord,
} from './reddit.types';

type RawCardRecord = Omit<RedditPostRecord, 'placements' | 'comments'> & {
  placementRank: number;
};

type StartResult = unknown;

type PatchableCrawler = {
  start(config: RedditCrawlConfig): StartResult;
  extractCards(page: Page): Promise<RawCardRecord[]>;
  waitForCandidates(page: Page): Promise<void>;
  waitForFeedGrowth(page: Page, previousCount: number): Promise<void>;
};

type RecoveryState = {
  misses: number;
  reloads: number;
};

const PERMALINK_SELECTOR = 'a[href*="/comments/"]';

export function applyCrawlerRecovery(crawler: unknown): void {
  const runtime = crawler as PatchableCrawler;
  const originalStart = runtime.start.bind(runtime);
  const originalExtractCards = runtime.extractCards.bind(runtime);
  const recoveryState = new WeakMap<Page, RecoveryState>();

  Object.defineProperty(runtime, 'start', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (config: RedditCrawlConfig): StartResult =>
      originalStart({
        ...config,
        sources: config.sources.map((source) => ({
          ...source,
          maxScrolls: Math.max(
            source.maxScrolls ?? 0,
            Math.max(40, source.targetPostCount * 3),
          ),
          maxStallRounds: Math.max(source.maxStallRounds ?? 0, 10),
        })),
      }),
  });

  Object.defineProperty(runtime, 'extractCards', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: async (page: Page): Promise<RawCardRecord[]> => {
      const primary = await originalExtractCards(page);
      const fallback = await extractPostsFromPermalinks(page);
      const merged = new Map<string, RawCardRecord>();

      for (const post of [...primary, ...fallback]) {
        const existing = merged.get(post.id);
        if (!existing) {
          merged.set(post.id, post);
          continue;
        }

        existing.content ??= post.content;
        existing.author ??= post.author;
        existing.authorProfileUrl ??= post.authorProfileUrl;
        existing.subreddit ??= post.subreddit;
        existing.subredditUrl ??= post.subredditUrl;
        existing.score ??= post.score;
        existing.commentCount ??= post.commentCount;
        existing.externalUrl ??= post.externalUrl;
        existing.media = mergeMedia(existing.media, post.media);
        existing.completeness =
          existing.completeness === 'FULL' || post.completeness === 'FULL'
            ? 'FULL'
            : existing.completeness;
      }

      return [...merged.values()];
    },
  });

  Object.defineProperty(runtime, 'waitForCandidates', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: async (page: Page): Promise<void> => {
      await page
        .waitForFunction(
          (selector) =>
            [...document.querySelectorAll<HTMLAnchorElement>(selector)].some((anchor) =>
              /\/comments\/[a-z0-9]+(?:\/|$)/i.test(anchor.href),
            ),
          PERMALINK_SELECTOR,
          { timeout: 15_000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(1_200);
    },
  });

  Object.defineProperty(runtime, 'waitForFeedGrowth', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: async (page: Page): Promise<void> => {
      const state = recoveryState.get(page) ?? { misses: 0, reloads: 0 };
      const beforeIds = await getVisiblePostIds(page);

      await clickLoadControls(page);
      await performScrollPass(page, state.misses);

      const foundNewPost = await page
        .waitForFunction(
          ({ selector, knownIds }) => {
            const known = new Set(knownIds);
            return [...document.querySelectorAll<HTMLAnchorElement>(selector)].some((anchor) => {
              const id = anchor.href.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1];
              return Boolean(id && !known.has(id));
            });
          },
          { selector: PERMALINK_SELECTOR, knownIds: beforeIds },
          { timeout: 6_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (foundNewPost) {
        recoveryState.set(page, { misses: 0, reloads: state.reloads });
        await page.waitForTimeout(700);
        return;
      }

      state.misses += 1;

      if (state.misses === 2) {
        await page.evaluate(() => {
          window.scrollBy(0, -Math.floor(window.innerHeight * 0.45));
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          window.scrollBy(0, Math.floor(window.innerHeight * 1.8));
        });
      }

      if (state.misses >= 4 && state.reloads < 1) {
        state.reloads += 1;
        state.misses = 0;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500);
      } else {
        await page.waitForTimeout(Math.min(1_000 + state.misses * 350, 3_000));
      }

      recoveryState.set(page, state);
    },
  });
}

async function getVisiblePostIds(page: Page): Promise<string[]> {
  return page.locator(PERMALINK_SELECTOR).evaluateAll((anchors) => {
    const ids = new Set<string>();
    for (const element of anchors) {
      const anchor = element as HTMLAnchorElement;
      const id = anchor.href.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1];
      if (id) ids.add(id);
    }
    return [...ids];
  });
}

async function clickLoadControls(page: Page): Promise<void> {
  const controls = [
    page.getByRole('button', { name: /show more posts|load more|see more|retry|try again/i }),
    page.locator('[data-testid*="load-more" i]'),
    page.locator('faceplate-tracker[noun*="load_more" i] button'),
  ];

  for (const candidate of controls) {
    const button = candidate.first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function performScrollPass(page: Page, misses: number): Promise<void> {
  await page.evaluate(
    ({ selector, missesCount }) => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>(selector)].filter((anchor) =>
        /\/comments\/[a-z0-9]+(?:\/|$)/i.test(anchor.href),
      );
      const last = links.at(-1);
      last?.scrollIntoView({ block: 'end', behavior: 'instant' });

      const multiplier = missesCount > 1 ? 2.2 : 1.35;
      window.scrollBy(0, Math.floor(window.innerHeight * multiplier));

      if (missesCount > 2) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      }
    },
    { selector: PERMALINK_SELECTOR, missesCount: misses },
  );

  await page.keyboard.press('PageDown').catch(() => undefined);
  if (misses > 1) await page.keyboard.press('End').catch(() => undefined);
}

async function extractPostsFromPermalinks(page: Page): Promise<RawCardRecord[]> {
  return page.locator(PERMALINK_SELECTOR).evaluateAll((anchors) => {
    const normalize = (value: string | null | undefined): string | undefined => {
      const normalized = value?.replace(/\s+/g, ' ').trim();
      return normalized || undefined;
    };
    const absolute = (value: string | null | undefined): string | undefined => {
      if (!value) return undefined;
      try {
        return new URL(value, location.origin).href;
      } catch {
        return undefined;
      }
    };
    const compactNumber = (value: string | null | undefined): number | undefined => {
      if (!value) return undefined;
      const normalized = value.toLowerCase().replace(/,/g, '').trim();
      const match = normalized.match(/-?\d+(?:\.\d+)?/);
      if (!match) return undefined;
      let parsed = Number(match[0]);
      if (normalized.includes('k')) parsed *= 1_000;
      if (normalized.includes('m')) parsed *= 1_000_000;
      return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
    };

    const records = new Map<string, RawCardRecord>();

    for (const [index, element] of anchors.entries()) {
      const anchor = element as HTMLAnchorElement;
      const permalink = absolute(anchor.getAttribute('href'));
      const postId = permalink?.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1];
      if (!permalink || !postId) continue;
      const id = `t3_${postId}`;
      if (records.has(id)) continue;

      const container =
        anchor.closest('shreddit-post') ??
        anchor.closest('article') ??
        anchor.closest('[data-testid="post-container"]') ??
        anchor.closest('[data-post-click-location]') ??
        anchor.closest('[role="article"]') ??
        anchor.closest('.thing.link') ??
        anchor.parentElement?.parentElement?.parentElement ??
        anchor.parentElement;
      if (!container) continue;

      const title =
        normalize(container.getAttribute('post-title')) ??
        normalize(
          container.querySelector<HTMLElement>(
            '[slot="title"], [data-testid="post-title"], h1, h2, h3, a[slot="title"]',
          )?.innerText,
        ) ??
        normalize(anchor.getAttribute('aria-label')) ??
        (normalize(anchor.innerText)?.length ?? 0) > 8
          ? normalize(anchor.innerText)
          : undefined;
      if (!title) continue;

      const author = normalize(
        container.getAttribute('author') ??
          container.getAttribute('data-author') ??
          container.querySelector<HTMLAnchorElement>('a[href*="/user/"]')?.textContent,
      )?.replace(/^u\//, '');
      const subreddit = normalize(
        container.getAttribute('subreddit-prefixed-name') ??
          container.getAttribute('subreddit-name') ??
          container.getAttribute('data-subreddit') ??
          container.querySelector<HTMLAnchorElement>('a[href^="/r/"]')?.textContent,
      )?.replace(/^r\//, '');
      const content = normalize(
        container.querySelector<HTMLElement>(
          '[slot="text-body"], shreddit-post-text-body, [data-testid="post-content"], .usertext-body .md, .expando .md',
        )?.innerText,
      );

      const scoreText =
        container.getAttribute('score') ??
        container.querySelector<HTMLElement>('[data-testid="post-vote-count"], .score')?.innerText;
      const commentText =
        container.getAttribute('comment-count') ??
        container.querySelector<HTMLElement>('[data-testid="comment-count"], a.comments')?.innerText;
      const media: RedditMedia[] = [];
      const mediaUrls = new Set<string>();

      container.querySelectorAll<HTMLImageElement>('img[src], faceplate-img').forEach((image) => {
        const url = absolute(
          image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src'),
        );
        if (!url || mediaUrls.has(url) || /avatar|icon|emoji|award|snoo/i.test(url)) return;
        if (image.width > 0 && image.width < 120) return;
        mediaUrls.add(url);
        media.push({
          type: media.length === 0 ? 'IMAGE' : 'GALLERY_IMAGE',
          url,
          width: image.naturalWidth || image.width || undefined,
          height: image.naturalHeight || image.height || undefined,
          alt: normalize(image.alt),
          order: media.length,
        });
      });

      const promoted = /promoted/i.test(container.textContent ?? '');
      const pinned =
        container.hasAttribute('is-stickied') ||
        container.classList.contains('stickied') ||
        /pinned|stickied/i.test(
          container.querySelector<HTMLElement>('[aria-label*="pinned" i], [aria-label*="stickied" i]')
            ?.getAttribute('aria-label') ?? '',
        );
      const nsfw =
        container.hasAttribute('is-nsfw') ||
        container.classList.contains('over18') ||
        Boolean(container.querySelector('[aria-label*="nsfw" i]'));
      const summarySource = content ? `${title}. ${content}` : title;

      records.set(id, {
        id,
        canonicalUrl: permalink,
        author,
        authorProfileUrl: author ? absolute(`/user/${author}/`) : undefined,
        subreddit,
        subredditUrl: subreddit ? absolute(`/r/${subreddit}/`) : undefined,
        title,
        content,
        summary:
          summarySource.length > 500
            ? `${summarySource.slice(0, 497)}...`
            : summarySource,
        summaryType: 'excerpt',
        externalUrl: undefined,
        postType: media.length > 0 ? 'IMAGE' : 'UNKNOWN',
        media,
        score: compactNumber(scoreText),
        scoreHidden: compactNumber(scoreText) === undefined,
        likeCount: null,
        viewerVote: 'NONE',
        commentCount: compactNumber(commentText),
        createdAt:
          container.getAttribute('created-timestamp') ??
          container.getAttribute('data-timestamp') ??
          undefined,
        flags: {
          promoted,
          pinned,
          locked: container.hasAttribute('is-locked') || container.hasAttribute('locked'),
          spoiler: container.hasAttribute('is-spoiler') || container.hasAttribute('spoiler'),
          nsfw,
          deleted: /\[deleted\]/i.test(content ?? ''),
          removed: /\[removed\]/i.test(content ?? ''),
        },
        capturedAt: new Date().toISOString(),
        completeness: content || media.length > 0 ? 'FULL' : 'CARD',
        placementRank: index + 1,
      });
    }

    return [...records.values()];
  });
}

function mergeMedia(left: RedditMedia[], right: RedditMedia[]): RedditMedia[] {
  const merged = new Map<string, RedditMedia>();
  for (const item of [...left, ...right]) {
    if (!merged.has(item.url)) merged.set(item.url, item);
  }
  return [...merged.values()].map((item, index) => ({ ...item, order: index }));
}
