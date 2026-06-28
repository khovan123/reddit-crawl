(() => {
  let lastRenderedJob = null;

  const copyText = {
    vi: {
      partial: 'Chưa đủ số bài',
      completed: 'Đã lấy đủ số bài',
      running: 'Đang thu thập dữ liệu',
      queued: 'Đang chuẩn bị quét',
      failed: 'Không thể hoàn thành lần quét',
      cancelled: 'Đã dừng lần quét',
      ready: 'Sẵn sàng',
      collected: 'Đã lấy',
      target: 'Mục tiêu',
      missing: 'Còn thiếu',
      sourceDone: 'Nguồn hoàn tất',
      sourceMissing: 'Nguồn chưa đủ',
      posts: 'bài',
      remaining: 'Còn thiếu {count} bài',
      loadingMoreStopped: 'Reddit không tải thêm bài mới sau {rounds} lần thử.',
      noMorePage: 'Không còn trang tiếp theo để tải thêm bài.',
      noPosts: 'Không tìm thấy bài phù hợp ở nguồn này.',
      saved: 'Đã lưu file kết quả',
      copyPath: 'Sao chép đường dẫn',
      copied: 'Đã sao chép',
      copyId: 'Sao chép mã',
      retry: 'Quét lại',
      technical: 'Xem chi tiết kỹ thuật',
      jobId: 'Mã lần quét',
      progress: 'Tiến độ',
      overallPartial: 'Đã lấy {collected}/{requested} bài. Còn thiếu {missing} bài từ {sources} nguồn.',
      overallCompleted: 'Đã lấy đủ {requested} bài từ tất cả nguồn đã chọn.',
      overallRunning: 'Đã lấy {collected}/{requested} bài. Dữ liệu đang tiếp tục được cập nhật.',
      overallFailed: 'Lần quét dừng trước khi hoàn thành. Xem từng nguồn để biết nguyên nhân.',
      pending: 'Đang chờ',
      collecting: 'Đang lấy bài',
      done: 'Hoàn tất',
      insufficient: 'Chưa đủ số bài',
      unavailable: 'Không thể lấy dữ liệu',
      home: 'Trang chủ',
      popular: 'Phổ biến',
      news: 'Tin tức',
      best: 'Tốt nhất',
      following: 'Đang theo dõi',
      latest: 'Mới nhất',
      subreddit: 'Subreddit',
      customUrl: 'URL Reddit',
    },
    en: {
      partial: 'Post target not reached',
      completed: 'Post target reached',
      running: 'Collecting data',
      queued: 'Preparing crawl',
      failed: 'Crawl could not be completed',
      cancelled: 'Crawl stopped',
      ready: 'Ready',
      collected: 'Collected',
      target: 'Target',
      missing: 'Missing',
      sourceDone: 'Sources completed',
      sourceMissing: 'Sources incomplete',
      posts: 'posts',
      remaining: '{count} posts remaining',
      loadingMoreStopped: 'Reddit did not load new posts after {rounds} attempts.',
      noMorePage: 'No next page is available for more posts.',
      noPosts: 'No matching posts were found in this source.',
      saved: 'Result file saved',
      copyPath: 'Copy path',
      copied: 'Copied',
      copyId: 'Copy ID',
      retry: 'Crawl again',
      technical: 'View technical details',
      jobId: 'Crawl ID',
      progress: 'Progress',
      overallPartial: 'Collected {collected}/{requested} posts. {missing} posts are still missing from {sources} sources.',
      overallCompleted: 'Collected all {requested} requested posts.',
      overallRunning: 'Collected {collected}/{requested} posts. Results are still updating.',
      overallFailed: 'The crawl stopped before completion. Review each source for details.',
      pending: 'Waiting',
      collecting: 'Collecting posts',
      done: 'Completed',
      insufficient: 'Post target not reached',
      unavailable: 'Unable to collect data',
      home: 'Home',
      popular: 'Popular',
      news: 'News',
      best: 'Best',
      following: 'Following',
      latest: 'Latest',
      subreddit: 'Subreddit',
      customUrl: 'Reddit URL',
    },
  };

  function locale() {
    return window.RedditI18n?.getLocale?.() === 'en' ? 'en' : 'vi';
  }

  function tx(key, values = {}) {
    let value = copyText[locale()][key] ?? key;
    for (const [name, replacement] of Object.entries(values)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function statusClass(status) {
    if (status === 'COMPLETED' || status === 'DONE') return 'done';
    if (status === 'PARTIAL') return 'partial';
    if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
    if (status === 'RUNNING' || status === 'QUEUED') return 'running';
    return 'pending';
  }

  function jobStatusText(status) {
    return {
      COMPLETED: tx('completed'),
      PARTIAL: tx('partial'),
      RUNNING: tx('running'),
      QUEUED: tx('queued'),
      FAILED: tx('failed'),
      CANCELLED: tx('cancelled'),
    }[status] ?? tx('ready');
  }

  function sourceStatusText(status) {
    return {
      PENDING: tx('pending'),
      RUNNING: tx('collecting'),
      DONE: tx('done'),
      PARTIAL: tx('insufficient'),
      FAILED: tx('unavailable'),
    }[status] ?? status;
  }

  function sourceBaseName(type) {
    return {
      HOME: tx('home'),
      POPULAR: tx('popular'),
      NEWS: tx('news'),
      BEST: tx('best'),
      FOLLOWING: tx('following'),
      LATEST: tx('latest'),
      SUBREDDIT: tx('subreddit'),
      CUSTOM_URL: tx('customUrl'),
    }[type] ?? type;
  }

  function sourceName(source) {
    if (source.sourceType === 'SUBREDDIT') {
      const row = [...document.querySelectorAll('.subreddit-row')]
        .find((element) => element.dataset.id === source.sourceId);
      const name = row?.querySelector('[data-field="subreddit"]')?.value?.trim();
      return name ? `r/${name.replace(/^r\//i, '')}` : sourceBaseName(source.sourceType);
    }

    if (source.sourceType === 'CUSTOM_URL') {
      const row = [...document.querySelectorAll('.url-row')]
        .find((element) => element.dataset.id === source.sourceId);
      const value = row?.querySelector('[data-field="url"]')?.value?.trim();
      if (value) {
        try {
          const parsed = new URL(value);
          return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '');
        } catch {
          return value;
        }
      }
    }

    return sourceBaseName(source.sourceType);
  }

  function friendlyReason(source) {
    const remaining = Math.max(0, source.requested - source.collected);
    const raw = source.message || '';
    const stalled = raw.match(/No new posts after (\d+) rounds/i);

    if (source.status === 'DONE') return '';
    if (stalled) {
      return `${tx('remaining', { count: remaining })}. ${tx('loadingMoreStopped', { rounds: stalled[1] })}`;
    }
    if (/No next page was available/i.test(raw)) {
      return `${tx('remaining', { count: remaining })}. ${tx('noMorePage')}`;
    }
    if (source.collected === 0 && source.status === 'PARTIAL') {
      return `${tx('remaining', { count: remaining })}. ${tx('noPosts')}`;
    }
    if (source.status === 'PARTIAL') return tx('remaining', { count: remaining });
    return raw || sourceStatusText(source.status);
  }

  function progressBar(percent, className = '') {
    const track = node('div', `crawl-progress-track ${className}`.trim());
    const fill = node('div', 'crawl-progress-fill');
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    track.append(fill);
    return track;
  }

  function createCopyButton(value, label) {
    const button = node('button', 'crawl-copy-button', label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(value);
      const original = button.textContent;
      button.textContent = tx('copied');
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1_500);
    });
    return button;
  }

  function buildTechnicalLog(job) {
    const lines = [
      `Status: ${job.status}`,
      `Job: ${job.jobId}`,
      '',
      ...job.sources.map((source) =>
        `${source.sourceType} ${source.collected}/${source.requested} · ${source.status}` +
        (source.message ? `\n  ${source.message}` : ''),
      ),
    ];
    if (job.outputFile) lines.push('', `Output: ${job.outputFile}`);
    if (job.error) lines.push('', `Error: ${job.error}`);
    return lines.join('\n');
  }

  function setBadge(job) {
    const badge = document.querySelector('#jobStatusBadge');
    const panel = document.querySelector('#progressPanel');
    if (!badge || !panel) return;

    badge.className = `job-badge ${statusClass(job.status)}`;
    badge.textContent = jobStatusText(job.status);
    panel.classList.remove('success', 'warning', 'error', 'active');
    if (job.status === 'COMPLETED') panel.classList.add('success');
    if (job.status === 'PARTIAL') panel.classList.add('warning');
    if (job.status === 'FAILED' || job.status === 'CANCELLED') panel.classList.add('error');
    if (job.status === 'RUNNING' || job.status === 'QUEUED') panel.classList.add('active');
  }

  function overviewDescription(job, collected, requested, missing, incompleteSources) {
    if (job.status === 'COMPLETED') return tx('overallCompleted', { requested });
    if (job.status === 'PARTIAL') {
      return tx('overallPartial', {
        collected,
        requested,
        missing,
        sources: incompleteSources,
      });
    }
    if (job.status === 'RUNNING' || job.status === 'QUEUED') {
      return tx('overallRunning', { collected, requested });
    }
    return tx('overallFailed');
  }

  function renderStructuredJob(job) {
    lastRenderedJob = job;
    setBadge(job);

    const panel = document.querySelector('#progressPanel');
    const oldSummary = document.querySelector('#progressSummary');
    const oldLog = document.querySelector('#statusText');
    if (!panel || !oldSummary || !oldLog) return;

    oldSummary.classList.add('hidden');
    oldLog.classList.add('structured-hidden-log');
    document.querySelector('#structuredJobResults')?.remove();

    const requested = job.sources.reduce((sum, source) => sum + source.requested, 0);
    const collected = job.sources.reduce((sum, source) => sum + source.collected, 0);
    const missing = Math.max(0, requested - collected);
    const completedSources = job.sources.filter((source) => source.status === 'DONE').length;
    const incompleteSources = job.sources.length - completedSources;
    const percent = requested > 0 ? Math.round((collected / requested) * 100) : 0;

    const shell = node('div', 'structured-job-results');
    shell.id = 'structuredJobResults';

    const overview = node('section', `crawl-overview ${statusClass(job.status)}`);
    const heading = node('div', 'crawl-overview-heading');
    const headingCopy = node('div', 'crawl-overview-copy');
    headingCopy.append(
      node('span', 'crawl-overview-kicker', jobStatusText(job.status)),
      node('h3', '', jobStatusText(job.status)),
      node(
        'p',
        '',
        overviewDescription(job, collected, requested, missing, incompleteSources),
      ),
    );
    const percentage = node('strong', 'crawl-overview-percent', `${percent}%`);
    heading.append(headingCopy, percentage);
    overview.append(heading, progressBar(percent, statusClass(job.status)));

    const stats = node('div', 'crawl-overview-stats');
    const statValues = [
      [collected, tx('collected')],
      [requested, tx('target')],
      [missing, tx('missing')],
      [`${completedSources}/${job.sources.length}`, tx('sourceDone')],
    ];
    for (const [value, label] of statValues) {
      const stat = node('div', 'crawl-overview-stat');
      stat.append(node('strong', '', String(value)), node('span', '', label));
      stats.append(stat);
    }
    overview.append(stats);

    const meta = node('div', 'crawl-job-meta');
    const idGroup = node('div', 'crawl-job-id');
    idGroup.append(node('span', '', tx('jobId')), node('code', '', job.jobId));
    meta.append(idGroup, createCopyButton(job.jobId, tx('copyId')));
    overview.append(meta);

    if (['PARTIAL', 'FAILED', 'CANCELLED'].includes(job.status)) {
      const retryButton = node('button', 'crawl-retry-button', tx('retry'));
      retryButton.type = 'button';
      retryButton.addEventListener('click', () => document.querySelector('#startButton')?.click());
      overview.append(retryButton);
    }

    shell.append(overview);

    const sourceList = node('div', 'crawl-source-results');
    for (const source of job.sources) {
      const sourcePercent = source.requested > 0
        ? Math.round((source.collected / source.requested) * 100)
        : 0;
      const card = node('article', `crawl-source-result ${statusClass(source.status)}`);
      const cardHeader = node('div', 'crawl-source-header');
      const sourceIdentity = node('div', 'crawl-source-identity');
      sourceIdentity.append(
        node('span', `crawl-source-dot ${statusClass(source.status)}`),
        node('strong', '', sourceName(source)),
      );
      const sourceBadge = node(
        'span',
        `crawl-source-badge ${statusClass(source.status)}`,
        sourceStatusText(source.status),
      );
      cardHeader.append(sourceIdentity, sourceBadge);

      const countRow = node('div', 'crawl-source-count-row');
      countRow.append(
        node('span', '', `${source.collected}/${source.requested} ${tx('posts')}`),
        node('strong', '', `${sourcePercent}%`),
      );
      card.append(cardHeader, countRow, progressBar(sourcePercent, statusClass(source.status)));

      const reason = friendlyReason(source);
      if (reason) card.append(node('p', 'crawl-source-reason', reason));
      sourceList.append(card);
    }
    shell.append(sourceList);

    if (job.outputFile) {
      const output = node('div', 'crawl-output-file');
      const outputCopy = node('div', 'crawl-output-copy');
      outputCopy.append(
        node('strong', '', tx('saved')),
        node('code', '', job.outputFile),
      );
      output.append(outputCopy, createCopyButton(job.outputFile, tx('copyPath')));
      shell.append(output);
    }

    const details = node('details', 'crawl-technical-details');
    details.append(
      node('summary', '', tx('technical')),
      node('pre', '', buildTechnicalLog(job)),
    );
    shell.append(details);

    oldLog.before(shell);
  }

  function install() {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('job-results.css');
    document.head.append(stylesheet);

    window.renderJob = renderStructuredJob;
    window.addEventListener('reddit-i18n-changed', () => {
      if (lastRenderedJob) renderStructuredJob(lastRenderedJob);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
