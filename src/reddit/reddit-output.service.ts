import { Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CrawlOutput } from './reddit.types';

@Injectable()
export class RedditOutputService {
  async write(output: CrawlOutput): Promise<{
    outputFile: string;
    latestOutputFile: string;
  }> {
    const root = process.cwd();
    const safeJobId = output.jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFile = join(root, `reddit-crawl-${safeJobId}.json`);
    const latestOutputFile = join(root, 'reddit-crawl-result.json');
    const json = `${JSON.stringify(output, null, 2)}\n`;

    await Promise.all([
      writeFile(outputFile, json, 'utf8'),
      writeFile(latestOutputFile, json, 'utf8'),
    ]);

    return { outputFile, latestOutputFile };
  }
}
