import { Injectable } from '@nestjs/common';
import { RedditSessionSnapshot } from './reddit.types';

@Injectable()
export class RedditSessionService {
  private snapshot: RedditSessionSnapshot | null = null;

  set(snapshot: RedditSessionSnapshot): void {
    this.snapshot = structuredClone(snapshot);
  }

  get(): RedditSessionSnapshot | null {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  clear(): void {
    this.snapshot = null;
  }

  getStatus(): {
    connected: boolean;
    issuedAt?: string;
    sourceUrl?: string;
    cookieCount?: number;
  } {
    if (!this.snapshot) {
      return { connected: false };
    }

    return {
      connected: true,
      issuedAt: this.snapshot.issuedAt,
      sourceUrl: this.snapshot.sourceUrl,
      cookieCount: this.snapshot.cookies.length,
    };
  }
}
