import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Browser,
  BrowserContext,
  Page,
} from 'playwright';
import { chromium } from 'playwright';
import { RedditOutputService } from './reddit-output.service';
import { RedditSessionService } from './reddit-session.service';
import {
  CrawlJobState,
  CrawlOutput,
  CrawlSourceProgress,
  RedditCrawlConfig,
  RedditMedia,
  RedditPostRecord,
  RedditSessionSnapshot,
  RedditSourceConfig,
} from './reddit.types';

type PlaywrightCookie = Parameters<BrowserContext['addCookies']>[0][number];

const POST_SELECTOR = [
  'shreddit-post[id^="t3_"]',
  'article[data-testid="post-container"]',
  '.thing.link[data-fullname^="t3_"]',
].join(',');

interface RawCardRecord extends Omit<RedditPostRecord, 'placements' | 'comments'> {
  placementRank: number;
}

@Injectable()
export class RedditCrawlerService {
  private readonly jobs = new Map<string, CrawlJobState>();
  private readonly cancellation = new Map<string, AbortController>();
  private runningJobId: string | null = null;

  constructor(
    private readonly sessions: RedditSessionService,
    private readonly output: RedditOutputService,
  ) {}

  listJobs(): CrawlJobState[] {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  getJob(jobId: string): CrawlJobState {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Unknown crawl job: ${jobId}`);
    }

    return structuredClone(job);
  }

  start(config: RedditCrawlConfig): CrawlJobState {
    if (this.runningJobId) {
      throw new ConflictException(
        `Only one crawl job can run at a time. Active job: ${this.runningJobId}`,
      );
    }

    if (!this.sessions.get()) {
      throw new BadRequestException(
        'No Reddit session connected. Open Reddit and connect the browser extension first.',
      );
    }

    const jobId = randomUUID();
    const sources: CrawlSourceProgress[] = config.sources.map((source, index) => ({
      sourceId: source.id ?? `source-${index + 1}`,
      sourceType: source.type,
      requested: source.targetPostCount,
      collected: 0,
      scrollRound: 0,
      status: 'PENDING',
    }));

    const state: CrawlJobState = {
      jobId,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      sources,
    };

    this.jobs.set(jobId, state);
    const abortController = new AbortController();
    this.cancellation.set(jobId, abortController);
    this.runningJobId = jobId;

    void this.run(jobId, config, abortController.signal);
    return structuredClone(state);
  }

  cancel(jobId: string): CrawlJobState {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Unknown crawl job: ${jobId}`);
    }

    this.cancellation.get(jobId)?.abort();
    job.status = 'CANCELLED';
    job.completedAt = new Date().toISOString();
    return structuredClone(job);
  }

  private async run(
    jobId: string,
    config: RedditCrawlConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const state = this.jobs.get(jobId);
    if (!state) return;

    state.status = 'RUNNING';
    state.startedAt = new Date().toISOString();

    let browser: Browser | null = null;

    try {
      const session = this.sessions.get();
      if (!session) {
        throw new Error('Reddit session was cleared before the job started');
      }

      browser = await chromium.launch({
        headless: process.env.REDDIT_HEADLESS === 'true',
        channel: process.env.REDDIT_BROWSER_CHANNEL || undefined,
      });

      const context = await this.createContext(browser, session);
      await this.assertSession(context);

      const canonicalPosts = new Map<string, RedditPostRecord>();
      let partial = false;

      for (let index = 0; index < config.sources.length; index += 1) {
        this.throwIfCancelled(signal);
        const source = config.sources[index];
        const progress = state.sources[index];
        progress.status = 'RUNNING';

        try {
          const sourcePosts = await this.collectSource(
            context,
            source,
            progress,
            signal,
          );

          for (const sourcePost of sourcePosts) {
            const existing = canonicalPosts.get(sourcePost.id);
            if (!existing) {
              canonicalPosts.set(sourcePost.id, sourcePost);
              continue;
            }

            existing.placements.push(...sourcePost.placements);
            existing.score = sourcePost.score ?? existing.score;
            existing.commentCount =
              sourcePost.commentCount ?? existing.commentCount;
            existing.media = this.mergeMedia(existing.media, sourcePost.media);
          }

          if (sourcePosts.length < source.targetPostCount) {
            partial = true;
            progress.status = 'PARTIAL';
            progress.message = `Collected ${sourcePosts.length}/${source.targetPostCount} unique posts before the feed stalled.`;
          } else {
            progress.status = 'DONE';
          }
        } catch (error) {
          partial = true;
          progress.status = 'FAILED';
          progress.message = this.errorMessage(error);
        }
      }

      if (config.detail?.enabled !== false) {
        await this.enrichDetails(
          context,
          [...canonicalPosts.values()],
          config.detail?.maxParallelTabs ??
            Number(process.env.REDDIT_DETAIL_CONCURRENCY ?? 2),
          config.detail?.commentsTopN ?? 0,
          signal,
        );
      }

      const completedAt = new Date().toISOString();
      const output: CrawlOutput = {
        version: 1,
        jobId,
        startedAt: state.startedAt,
        completedAt,
        status: partial ? 'PARTIAL' : 'COMPLETED',
        stats: {
          requestedPosts: config.sources.reduce(
            (sum, source) => sum + source.targetPostCount,
            0,
          ),
          uniquePosts: canonicalPosts.size,
          sourceCount: config.sources.length,
        },
        sources: structuredClone(state.sources),
        posts: [...canonicalPosts.values()],
      };

      const files = await this.output.write(output);
      state.status = partial ? 'PARTIAL' : 'COMPLETED';
      state.completedAt = completedAt;
      state.outputFile = files.outputFile;
      state.latestOutputFile = files.latestOutputFile;
    } catch (error) {
      if (signal.aborted) {
        state.status = 'CANCELLED';
      } else {
        state.status = 'FAILED';
        state.error = this.errorMessage(error);
      }
      state.completedAt = new Date().toISOString();
    } finally {
      await browser?.close().catch(() => undefined);
      this.cancellation.delete(jobId);
      if (this.runningJobId === jobId) {
        this.runningJobId = null;
      }
    }
  }

  private async createContext(
    browser: Browser,
    session: RedditSessionSnapshot,
  ): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: session.browser.userAgent,
      locale: session.browser.locale,
      timezoneId: session.browser.timezone,
      viewport: {
        width: session.browser.viewport.width,
        height: session.browser.viewport.height,
      },
      deviceScaleFactor: session.browser.viewport.deviceScaleFactor,
    });

    const cookies = session.cookies.map((cookie): PlaywrightCookie => {
      const mapped: PlaywrightCookie = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: this.mapSameSite(cookie.sameSite),
      };

      if (!cookie.session && cookie.expirationDate) {
        mapped.expires = cookie.expirationDate;
      }

      if (cookie.partitionKey) {
        mapped.partitionKey = cookie.partitionKey;
      }

      return mapped;
    });

    await context.addCookies(cookies);

    if (session.localStorage && Object.keys(session.localStorage).length > 0) {
      await context.addInitScript((values: Record<string, string>) => {
        if (location.hostname === 'reddit.com' || location.hostname.endsWith('.reddit.com')) {
          for (const [key, value] of Object.entries(values)) {
            try {
              localStorage.setItem(key, value);
            } catch {
              // Ignore per-key storage errors.
            }
          }
        }
      }, session.localStorage);
    }

    return context;
  }

  private async assertSession(context: BrowserContext): Promise<void> {
    const page = await context.newPage();
    try {
      await page.goto('https://www.reddit.com/', {
        waitUntil: 'domcontentloaded',
        timeout: this.navigationTimeout,
      });
      await page.waitForTimeout(1500);

      if (new URL(page.url()).pathname.startsWith('/login')) {
        throw new Error('Reddit rejected the copied session and redirected to login');
      }
    } finally {
      await page.close();
    }
  }

  private async collectSource(
    context: BrowserContext,
    source: RedditSourceConfig,
    progress: CrawlSourceProgress,
    signal: AbortSignal,
  ): Promise<RedditPostRecord[]> {
    const page = await context.newPage();
    const sourceId = progress.sourceId;
    const posts = new Map<string, RedditPostRecord>();
    const maxScrolls = source.maxScrolls ?? Math.max(30, source.targetPostCount * 2);
    const maxStallRounds = source.maxStallRounds ?? 6;
    let stallRounds = 0;

    try {
      const url = this.buildSourceUrl(source);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.navigationTimeout,
      });
      await this.activateFeedTab(page, source.type);
      await page.waitForTimeout(1800);

      for (let scrollRound = 0; scrollRound <= maxScrolls; scrollRound += 1) {
        this.throwIfCancelled(signal);
        progress.scrollRound = scrollRound;

        const cards = await this.extractCards(page);
        const sizeBefore = posts.size;

        for (const card of cards) {
          if (!this.shouldInclude(card, source)) continue;

          const existing = posts.get(card.id);
          const placement = {
            sourceId,
            sourceType: source.type,
            sourceUrl: page.url(),
            rank: existing?.placements[0]?.rank ?? posts.size + 1,
            scrollRound,
            capturedAt: new Date().toISOString(),
          };

          if (existing) {
            existing.score = card.score ?? existing.score;
            existing.commentCount = card.commentCount ?? existing.commentCount;
            existing.media = this.mergeMedia(existing.media, card.media);
            continue;
          }

          const { placementRank: _placementRank, ...post } = card;
          posts.set(card.id, {
            ...post,
            comments: [],
            placements: [placement],
          });

          if (posts.size >= source.targetPostCount) break;
        }

        progress.collected = posts.size;
        if (posts.size >= source.targetPostCount) break;

        if (posts.size === sizeBefore) {
          stallRounds += 1;
        } else {
          stallRounds = 0;
        }

        if (stallRounds >= maxStallRounds) break;

        await page.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll(
              'shreddit-post[id^="t3_"], article[data-testid="post-container"], .thing.link[data-fullname^="t3_"]',
            ),
          );
          const last = cards.at(-1);
          last?.scrollIntoView({ block: 'end', behavior: 'instant' });
          window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
        });

        await this.waitForFeedGrowth(page, cards.length);
      }

      return [...posts.values()].slice(0, source.targetPostCount);
    } finally {
      await page.close();
    }
  }

  private async activateFeedTab(page: Page, type: RedditSourceConfig['type']): Promise<void> {
    if (type !== 'FOR_YOU' && type !== 'FOLLOWING') return;

    const label = type === 'FOR_YOU' ? /for you/i : /following/i;
    const candidates = [
      page.getByRole('tab', { name: label }),
      page.getByRole('button', { name: label }),
      page.getByRole('link', { name: label }),
      page.getByText(label, { exact: true }),
    ];

    for (const candidate of candidates) {
      const control = candidate.first();
      if (await control.isVisible().catch(() => false)) {
        await control.click().catch(() => undefined);
        await page.waitForTimeout(1200);
        return;
      }
    }
  }

  private async extractCards(page: Page): Promise<RawCardRecord[]> {
    return page.locator(POST_SELECTOR).evaluateAll((elements) => {
      const normalizeText = (value: string | null | undefined): string | undefined => {
        const normalized = value?.replace(/\s+/g, ' ').trim();
        return normalized || undefined;
      };

      const parseCompactNumber = (value: string | null | undefined): number | undefined => {
        if (!value) return undefined;
        const normalized = value.trim().toLowerCase().replace(/,/g, '');
        if (/hidden|vote|score/i.test(normalized) && !/[0-9]/.test(normalized)) {
          return undefined;
        }
        const match = normalized.match(/-?\d+(?:\.\d+)?/);
        if (!match) return undefined;
        let parsed = Number(match[0]);
        if (normalized.includes('k')) parsed *= 1_000;
        if (normalized.includes('m')) parsed *= 1_000_000;
        return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
      };

      const absoluteUrl = (value: string | null | undefined): string | undefined => {
        if (!value) return undefined;
        try {
          return new URL(value, location.origin).href;
        } catch {
          return undefined;
        }
      };

      const pickAttr = (element: Element, names: string[]): string | undefined => {
        for (const name of names) {
          const value = element.getAttribute(name);
          if (value) return value;
        }
        return undefined;
      };

      const records: RawCardRecord[] = [];

      elements.forEach((element, index) => {
        const host = element.matches('shreddit-post')
          ? element
          : element.querySelector('shreddit-post') ?? element;
        const article = element.closest('article') ?? element;
        const permalinkAnchor = article.querySelector<HTMLAnchorElement>(
          'a[href*="/comments/"]',
        );
        const permalink =
          absoluteUrl(pickAttr(host, ['permalink'])) ??
          absoluteUrl(permalinkAnchor?.getAttribute('href'));

        const idFromUrl = permalink?.match(/\/comments\/([a-z0-9]+)\//i)?.[1];
        const rawId =
          pickAttr(host, ['id', 'data-fullname', 'data-post-id']) ??
          pickAttr(article, ['data-fullname', 'data-post-id']);
        const id = rawId?.startsWith('t3_')
          ? rawId
          : idFromUrl
            ? `t3_${idFromUrl}`
            : rawId;

        const title =
          normalizeText(pickAttr(host, ['post-title'])) ??
          normalizeText(
            article.querySelector<HTMLElement>(
              '[slot="title"], h1, h2, h3, a.title, [data-testid="post-title"]',
            )?.innerText,
          );

        if (!id || !permalink || !title) return;

        const author =
          normalizeText(pickAttr(host, ['author', 'data-author'])) ??
          normalizeText(
            article.querySelector<HTMLAnchorElement>('a[href^="/user/"]')?.textContent,
          )?.replace(/^u\//, '');

        const subredditRaw =
          normalizeText(
            pickAttr(host, ['subreddit-prefixed-name', 'subreddit-name', 'data-subreddit']),
          ) ??
          normalizeText(
            article.querySelector<HTMLAnchorElement>('a[href^="/r/"]')?.textContent,
          );
        const subreddit = subredditRaw?.replace(/^r\//, '');

        const content = normalizeText(
          article.querySelector<HTMLElement>(
            '[slot="text-body"], shreddit-post-text-body, [data-testid="post-content"], .usertext-body, .md',
          )?.innerText,
        );

        const scoreText =
          pickAttr(host, ['score']) ??
          article.querySelector<HTMLElement>(
            '[slot="vote-count"], [data-testid="post-vote-count"], shreddit-post-vote-button, .score',
          )?.getAttribute('score') ??
          article.querySelector<HTMLElement>(
            '[slot="vote-count"], [data-testid="post-vote-count"], .score',
          )?.innerText;

        const commentsText =
          pickAttr(host, ['comment-count']) ??
          article.querySelector<HTMLElement>(
            '[data-testid="comment-count"], a[href*="/comments/"]',
          )?.innerText;

        const media: RedditMedia[] = [];
        const seenUrls = new Set<string>();
        article.querySelectorAll<HTMLImageElement>('img[src], faceplate-img').forEach((image) => {
          const source =
            image.currentSrc ||
            image.getAttribute('src') ||
            image.getAttribute('data-src');
          const url = absoluteUrl(source);
          if (!url || seenUrls.has(url)) return;
          if (/avatar|icon|emoji|award|snoo/i.test(url)) return;
          if (image.width > 0 && image.width < 120) return;
          seenUrls.add(url);
          media.push({
            type: media.length === 0 ? 'IMAGE' : 'GALLERY_IMAGE',
            url,
            width: image.naturalWidth || image.width || undefined,
            height: image.naturalHeight || image.height || undefined,
            alt: normalizeText(image.alt),
            order: media.length,
          });
        });

        const score = parseCompactNumber(scoreText);
        const scoreHidden = score === undefined;
        const promoted =
          /promoted/i.test(pickAttr(host, ['is-promoted', 'promoted']) ?? '') ||
          Boolean(article.querySelector('[aria-label*="promoted" i], [data-testid*="promoted" i]')) ||
          /promoted/i.test(article.textContent ?? '');
        const pinned =
          host.hasAttribute('is-stickied') ||
          host.hasAttribute('stickied') ||
          Boolean(article.querySelector('[aria-label*="pinned" i], [aria-label*="stickied" i]'));
        const nsfw =
          host.hasAttribute('is-nsfw') ||
          /nsfw/i.test(pickAttr(host, ['content-tags']) ?? '') ||
          Boolean(article.querySelector('[aria-label*="nsfw" i]'));
        const removed = /\[removed\]/i.test(content ?? '');
        const deleted = /\[deleted\]/i.test(content ?? '');

        const compact = content ? `${title}. ${content}` : title;
        const summary = compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;

        records.push({
          id,
          canonicalUrl: permalink,
          author,
          authorProfileUrl: author ? absoluteUrl(`/user/${author}/`) : undefined,
          subreddit,
          subredditUrl: subreddit ? absoluteUrl(`/r/${subreddit}/`) : undefined,
          title,
          content,
          summary,
          summaryType: 'excerpt',
          externalUrl: absoluteUrl(pickAttr(host, ['content-href', 'data-url'])),
          postType: pickAttr(host, ['post-type']) ?? (media.length ? 'IMAGE' : 'UNKNOWN'),
          media,
          score,
          scoreHidden,
          likeCount: null,
          viewerVote: 'NONE',
          commentCount: parseCompactNumber(commentsText),
          createdAt: pickAttr(host, ['created-timestamp', 'data-timestamp']),
          flags: {
            promoted,
            pinned,
            locked: host.hasAttribute('is-locked') || host.hasAttribute('locked'),
            spoiler: host.hasAttribute('is-spoiler') || host.hasAttribute('spoiler'),
            nsfw,
            deleted,
            removed,
          },
          capturedAt: new Date().toISOString(),
          completeness: content ? 'FULL' : 'CARD',
          placementRank: index + 1,
        });
      });

      return records;
    });
  }

  private shouldInclude(card: RawCardRecord, source: RedditSourceConfig): boolean {
    if (!source.includePromoted && card.flags.promoted) return false;
    if (!source.includePinned && card.flags.pinned) return false;
    if (!source.includeNsfw && card.flags.nsfw) return false;
    return true;
  }

  private async waitForFeedGrowth(page: Page, previousCount: number): Promise<void> {
    await Promise.race([
      page
        .waitForFunction(
          ({ selector, count }) => document.querySelectorAll(selector).length > count,
          { selector: POST_SELECTOR, count: previousCount },
          { timeout: 8_000 },
        )
        .catch(() => undefined),
      page.waitForTimeout(1600),
    ]);
  }

  private async enrichDetails(
    context: BrowserContext,
    posts: RedditPostRecord[],
    requestedConcurrency: number,
    commentsTopN: number,
    signal: AbortSignal,
  ): Promise<void> {
    const concurrency = Math.max(1, Math.min(4, requestedConcurrency));
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        this.throwIfCancelled(signal);
        const index = cursor;
        cursor += 1;
        if (index >= posts.length) return;

        const post = posts[index];
        const page = await context.newPage();
        try {
          await page.goto(post.canonicalUrl, {
            waitUntil: 'domcontentloaded',
            timeout: this.navigationTimeout,
          });
          await page.waitForTimeout(900);
          await this.enrichPostFromPage(page, post, commentsTopN);
        } catch {
          post.completeness = post.content ? 'PARTIAL' : 'CARD';
        } finally {
          await page.close();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  private async enrichPostFromPage(
    page: Page,
    post: RedditPostRecord,
    commentsTopN: number,
  ): Promise<void> {
    const detail = await page.evaluate((limit) => {
      const normalize = (value: string | null | undefined): string | undefined => {
        const result = value?.replace(/\s+/g, ' ').trim();
        return result || undefined;
      };

      const absolute = (value: string | null | undefined): string | undefined => {
        if (!value) return undefined;
        try {
          return new URL(value, location.origin).href;
        } catch {
          return undefined;
        }
      };

      const root =
        document.querySelector('shreddit-post[id^="t3_"]') ??
        document.querySelector('article[data-testid="post-container"]') ??
        document.querySelector('.thing.link[data-fullname^="t3_"]');

      const content = normalize(
        root?.querySelector<HTMLElement>(
          '[slot="text-body"], shreddit-post-text-body, [data-testid="post-content"], .usertext-body, .md',
        )?.innerText,
      );

      const images: Array<{
        url: string;
        width?: number;
        height?: number;
        alt?: string;
      }> = [];
      const seen = new Set<string>();

      root?.querySelectorAll<HTMLImageElement>('img[src], faceplate-img').forEach((image) => {
        const url = absolute(
          image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src'),
        );
        if (!url || seen.has(url)) return;
        if (/avatar|icon|emoji|award|snoo/i.test(url)) return;
        if (image.width > 0 && image.width < 120) return;
        seen.add(url);
        images.push({
          url,
          width: image.naturalWidth || image.width || undefined,
          height: image.naturalHeight || image.height || undefined,
          alt: normalize(image.alt),
        });
      });

      const comments = Array.from(
        document.querySelectorAll(
          'shreddit-comment, article[id^="t1_"], .thing.comment[data-fullname^="t1_"]',
        ),
      )
        .slice(0, limit)
        .map((comment) => {
          const id =
            comment.getAttribute('id') ??
            comment.getAttribute('data-fullname') ??
            undefined;
          const author = normalize(
            comment.getAttribute('author') ??
              comment.querySelector<HTMLAnchorElement>('a[href^="/user/"]')?.textContent,
          )?.replace(/^u\//, '');
          const body = normalize(
            comment.querySelector<HTMLElement>(
              '[slot="comment"], [data-testid="comment"], .md, .usertext-body',
            )?.innerText,
          );
          const permalink = absolute(
            comment.querySelector<HTMLAnchorElement>('a[href*="/comments/"]')?.href,
          );
          return body ? { id, author, body, permalink } : null;
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);

      return { content, images, comments };
    }, commentsTopN);

    if (detail.content) {
      post.content = detail.content;
    }

    if (detail.images.length > 0) {
      const images: RedditMedia[] = detail.images.map((image, index) => ({
        type: index === 0 ? 'IMAGE' : 'GALLERY_IMAGE',
        url: image.url,
        width: image.width,
        height: image.height,
        alt: image.alt,
        order: index,
      }));
      post.media = this.mergeMedia(post.media, images);
    }

    post.comments = detail.comments;
    const summarySource = post.content ? `${post.title}. ${post.content}` : post.title;
    post.summary =
      summarySource.length > 500
        ? `${summarySource.slice(0, 497)}...`
        : summarySource;
    post.completeness = post.content || post.media.length > 0 ? 'FULL' : 'PARTIAL';
  }

  private buildSourceUrl(source: RedditSourceConfig): string {
    const sort = source.sort?.toLowerCase();
    const timeRange = source.timeRange?.toLowerCase();

    switch (source.type) {
      case 'HOME':
      case 'FOR_YOU':
      case 'FOLLOWING':
        return 'https://www.reddit.com/';
      case 'POPULAR':
        return `https://www.reddit.com/r/popular/${sort ?? 'hot'}/`;
      case 'LATEST':
        return 'https://www.reddit.com/latest/';
      case 'SUBREDDIT': {
        const subreddit = source.subreddit?.replace(/^r\//, '');
        const url = new URL(
          `https://www.reddit.com/r/${encodeURIComponent(subreddit ?? '')}/${sort ?? 'hot'}/`,
        );
        if ((source.sort === 'TOP' || source.sort === 'BEST') && timeRange) {
          url.searchParams.set('t', timeRange);
        }
        return url.href;
      }
      case 'CUSTOM_URL':
        return source.url!;
      default:
        return 'https://www.reddit.com/';
    }
  }

  private mergeMedia(left: RedditMedia[], right: RedditMedia[]): RedditMedia[] {
    const map = new Map<string, RedditMedia>();
    for (const item of [...left, ...right]) {
      if (!map.has(item.url)) map.set(item.url, item);
    }
    return [...map.values()].map((item, index) => ({ ...item, order: index }));
  }

  private mapSameSite(value: string): PlaywrightCookie['sameSite'] | undefined {
    if (value === 'strict') return 'Strict';
    if (value === 'lax') return 'Lax';
    if (value === 'no_restriction') return 'None';
    return undefined;
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('CRAWL_CANCELLED');
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private get navigationTimeout(): number {
    return Number(process.env.REDDIT_NAVIGATION_TIMEOUT_MS ?? 45_000);
  }
}
