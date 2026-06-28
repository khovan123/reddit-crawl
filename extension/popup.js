const BUILTIN_FEEDS = [
  { type: 'HOME', label: 'Trang chủ', hint: 'Bài từ trang Home', icon: 'H', count: 50 },
  { type: 'POPULAR', label: 'Phổ biến', hint: 'Bài nổi bật trên Reddit', icon: 'P', count: 50 },
  { type: 'NEWS', label: 'Tin tức', hint: 'Nguồn Reddit News', icon: 'N', count: 50 },
  { type: 'BEST', label: 'Tốt nhất', hint: 'Bài nổi bật toàn cầu', icon: 'B', count: 50 },
  { type: 'FOLLOWING', label: 'Đang theo dõi', hint: 'Nguồn tài khoản đang theo dõi', icon: 'F', count: 50 },
  { type: 'LATEST', label: 'Mới nhất', hint: 'Các bài vừa được đăng', icon: 'L', count: 50 },
];

const JOB_LABELS = {
  QUEUED: 'Đang chuẩn bị',
  RUNNING: 'Đang quét',
  COMPLETED: 'Hoàn tất',
  PARTIAL: 'Hoàn tất một phần',
  FAILED: 'Có lỗi xảy ra',
  CANCELLED: 'Đã dừng',
};

const SOURCE_STATUS_LABELS = {
  PENDING: 'Đang chờ',
  RUNNING: 'Đang lấy bài',
  DONE: 'Hoàn tất',
  PARTIAL: 'Chưa đủ số bài',
  FAILED: 'Không thể lấy dữ liệu',
};

const SOURCE_TYPE_LABELS = {
  HOME: 'Trang chủ',
  POPULAR: 'Phổ biến',
  NEWS: 'Tin tức',
  BEST: 'Tốt nhất',
  FOLLOWING: 'Đang theo dõi',
  LATEST: 'Mới nhất',
  SUBREDDIT: 'Subreddit',
  CUSTOM_URL: 'URL Reddit',
};

const DRAFT_KEY = 'redditCrawlerDraftV2';
const builtinFeedsElement = document.querySelector('#builtinFeeds');
const subredditListElement = document.querySelector('#subredditList');
const urlListElement = document.querySelector('#urlList');
const subredditTemplate = document.querySelector('#subredditTemplate');
const urlTemplate = document.querySelector('#urlTemplate');
const statusText = document.querySelector('#statusText');
const startButton = document.querySelector('#startButton');
const connectionButton = document.querySelector('#connectionButton');
const connectionLabel = document.querySelector('#connectionLabel');
const connectionBanner = document.querySelector('#connectionBanner');
const connectionTitle = document.querySelector('#connectionTitle');
const connectionMessage = document.querySelector('#connectionMessage');
const connectButton = document.querySelector('#connectButton');
const jobStatusBadge = document.querySelector('#jobStatusBadge');
const progressSummary = document.querySelector('#progressSummary');
const progressPanel = document.querySelector('#progressPanel');
let pollTimer = null;
let saveTimer = null;

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function defaultDraft() {
  return {
    builtins: Object.fromEntries(
      BUILTIN_FEEDS.map((feed) => [
        feed.type,
        { enabled: true, targetPostCount: feed.count },
      ]),
    ),
    subreddits: [
      {
        id: createId('subreddit'),
        enabled: true,
        subreddit: 'smallbusiness',
        sort: 'NEW',
        targetPostCount: 100,
      },
    ],
    urls: [],
    settings: {
      detailEnabled: true,
      commentsTopN: 0,
      includePromoted: false,
      includePinned: false,
      includeNsfw: false,
    },
  };
}

function normalizeCount(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(2000, parsed));
}

function friendlyErrorMessage(error) {
  const raw = typeof error === 'string' ? error : error?.message || String(error || '');

  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) {
    return 'Chưa thể liên lạc với ứng dụng Reddit Crawl trên máy.';
  }

  if (/backend không phản hồi|không phản hồi trong 10 giây/i.test(raw)) {
    return 'Ứng dụng Reddit Crawl chưa phản hồi. Tiện ích sẽ tự thử lại.';
  }

  if (/hãy mở reddit trong tab hiện tại/i.test(raw)) {
    return 'Hãy mở một tab Reddit đã đăng nhập để tiện ích kết nối tài khoản.';
  }

  if (/không tìm thấy cookie reddit/i.test(raw)) {
    return 'Chưa tìm thấy phiên đăng nhập Reddit. Hãy đăng nhập Reddit rồi thử lại.';
  }

  if (/kết nối backend thất bại/i.test(raw)) {
    return 'Chưa thể kết nối với ứng dụng Reddit Crawl trên máy.';
  }

  return raw || 'Đã có lỗi xảy ra. Hãy thử lại sau ít phút.';
}

function migrateLastConfig(lastConfig) {
  const draft = defaultDraft();
  if (!lastConfig?.sources?.length) return draft;

  for (const feed of BUILTIN_FEEDS) {
    draft.builtins[feed.type].enabled = false;
  }
  draft.subreddits = [];
  draft.urls = [];

  for (const source of lastConfig.sources) {
    if (draft.builtins[source.type]) {
      draft.builtins[source.type] = {
        enabled: true,
        targetPostCount: normalizeCount(source.targetPostCount),
      };
      continue;
    }

    if (source.type === 'SUBREDDIT' && source.subreddit) {
      draft.subreddits.push({
        id: createId('subreddit'),
        enabled: true,
        subreddit: source.subreddit,
        sort: source.sort || 'HOT',
        targetPostCount: normalizeCount(source.targetPostCount),
      });
      continue;
    }

    if (source.type === 'CUSTOM_URL' && source.url) {
      draft.urls.push({
        id: createId('url'),
        enabled: true,
        url: source.url,
        targetPostCount: normalizeCount(source.targetPostCount),
      });
    }
  }

  draft.settings = {
    detailEnabled: lastConfig.detail?.enabled !== false,
    commentsTopN: Number(lastConfig.detail?.commentsTopN || 0),
    includePromoted: Boolean(lastConfig.sources.some((source) => source.includePromoted)),
    includePinned: Boolean(lastConfig.sources.some((source) => source.includePinned)),
    includeNsfw: Boolean(lastConfig.sources.some((source) => source.includeNsfw)),
  };

  return draft;
}

function renderBuiltins(values) {
  builtinFeedsElement.replaceChildren();

  for (const feed of BUILTIN_FEEDS) {
    const current = values?.[feed.type] || {
      enabled: true,
      targetPostCount: feed.count,
    };
    const card = document.createElement('article');
    card.className = `feed-card${current.enabled ? ' enabled' : ''}`;
    card.dataset.type = feed.type;
    card.innerHTML = `
      <input class="toggle-input" data-field="enabled" type="checkbox" aria-label="Bật ${feed.label}" />
      <div class="feed-copy">
        <div class="feed-icon">${feed.icon}</div>
        <strong>${feed.label}</strong>
        <small>${feed.hint}</small>
      </div>
      <input class="feed-count" data-field="targetPostCount" type="number" min="1" max="2000" aria-label="Số bài ${feed.label}" />
    `;

    const enabledInput = card.querySelector('[data-field="enabled"]');
    const countInput = card.querySelector('[data-field="targetPostCount"]');
    enabledInput.checked = current.enabled !== false;
    countInput.value = normalizeCount(current.targetPostCount, feed.count);
    countInput.disabled = !enabledInput.checked;

    enabledInput.addEventListener('change', () => {
      card.classList.toggle('enabled', enabledInput.checked);
      countInput.disabled = !enabledInput.checked;
      scheduleSave();
      updateSelectionSummary();
    });
    countInput.addEventListener('input', () => {
      scheduleSave();
      updateSelectionSummary();
    });

    builtinFeedsElement.append(card);
  }
}

function addSubreddit(values = {}, persist = true) {
  const fragment = subredditTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.subreddit-row');
  row.dataset.id = values.id || createId('subreddit');
  const enabled = row.querySelector('[data-field="enabled"]');
  const subreddit = row.querySelector('[data-field="subreddit"]');
  const sort = row.querySelector('[data-field="sort"]');
  const count = row.querySelector('[data-field="targetPostCount"]');

  enabled.checked = values.enabled !== false;
  subreddit.value = values.subreddit || '';
  sort.value = values.sort || 'HOT';
  count.value = normalizeCount(values.targetPostCount, 50);

  const updateDisabled = () => {
    row.classList.toggle('disabled', !enabled.checked);
    subreddit.disabled = !enabled.checked;
    sort.disabled = !enabled.checked;
    count.disabled = !enabled.checked;
  };

  row.querySelector('[data-action="remove"]').addEventListener('click', () => {
    row.remove();
    updateEmptyStates();
    scheduleSave();
    updateSelectionSummary();
  });
  row.addEventListener('input', () => {
    scheduleSave();
    updateSelectionSummary();
  });
  row.addEventListener('change', () => {
    updateDisabled();
    scheduleSave();
    updateSelectionSummary();
  });

  updateDisabled();
  subredditListElement.append(row);
  updateEmptyStates();
  updateSelectionSummary();
  if (persist) scheduleSave();
}

function addUrl(values = {}, persist = true) {
  const fragment = urlTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.url-row');
  row.dataset.id = values.id || createId('url');
  const enabled = row.querySelector('[data-field="enabled"]');
  const url = row.querySelector('[data-field="url"]');
  const count = row.querySelector('[data-field="targetPostCount"]');

  enabled.checked = values.enabled !== false;
  url.value = values.url || '';
  count.value = normalizeCount(values.targetPostCount, 50);

  const updateDisabled = () => {
    row.classList.toggle('disabled', !enabled.checked);
    url.disabled = !enabled.checked;
    count.disabled = !enabled.checked;
  };

  row.querySelector('[data-action="remove"]').addEventListener('click', () => {
    row.remove();
    updateEmptyStates();
    scheduleSave();
    updateSelectionSummary();
  });
  row.addEventListener('input', () => {
    scheduleSave();
    updateSelectionSummary();
  });
  row.addEventListener('change', () => {
    updateDisabled();
    scheduleSave();
    updateSelectionSummary();
  });

  updateDisabled();
  urlListElement.append(row);
  updateEmptyStates();
  updateSelectionSummary();
  if (persist) scheduleSave();
}

function updateEmptyStates() {
  document.querySelector('#subredditEmpty').classList.toggle(
    'hidden',
    subredditListElement.children.length > 0,
  );
  document.querySelector('#urlEmpty').classList.toggle(
    'hidden',
    urlListElement.children.length > 0,
  );
}

function collectDraft() {
  const builtins = {};
  for (const card of builtinFeedsElement.querySelectorAll('.feed-card')) {
    builtins[card.dataset.type] = {
      enabled: card.querySelector('[data-field="enabled"]').checked,
      targetPostCount: normalizeCount(
        card.querySelector('[data-field="targetPostCount"]').value,
      ),
    };
  }

  const subreddits = [...subredditListElement.querySelectorAll('.subreddit-row')].map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    subreddit: row.querySelector('[data-field="subreddit"]').value.trim().replace(/^r\//i, ''),
    sort: row.querySelector('[data-field="sort"]').value,
    targetPostCount: normalizeCount(row.querySelector('[data-field="targetPostCount"]').value),
  }));

  const urls = [...urlListElement.querySelectorAll('.url-row')].map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    url: row.querySelector('[data-field="url"]').value.trim(),
    targetPostCount: normalizeCount(row.querySelector('[data-field="targetPostCount"]').value),
  }));

  return {
    builtins,
    subreddits,
    urls,
    settings: {
      detailEnabled: document.querySelector('#detailEnabled').checked,
      commentsTopN: Math.max(0, Math.min(50, Number(document.querySelector('#commentsTopN').value || 0))),
      includePromoted: document.querySelector('#includePromoted').checked,
      includePinned: document.querySelector('#includePinned').checked,
      includeNsfw: document.querySelector('#includeNsfw').checked,
    },
  };
}

function buildCrawlConfig() {
  const draft = collectDraft();
  const flags = {
    includePromoted: draft.settings.includePromoted,
    includePinned: draft.settings.includePinned,
    includeNsfw: draft.settings.includeNsfw,
  };
  const sources = [];

  for (const feed of BUILTIN_FEEDS) {
    const value = draft.builtins[feed.type];
    if (!value?.enabled) continue;
    sources.push({
      id: `builtin-${feed.type.toLowerCase()}`,
      type: feed.type,
      targetPostCount: value.targetPostCount,
      ...flags,
    });
  }

  for (const item of draft.subreddits) {
    if (!item.enabled) continue;
    if (!item.subreddit) throw new Error('Có một subreddit đang bật nhưng chưa nhập tên.');
    sources.push({
      id: item.id,
      type: 'SUBREDDIT',
      subreddit: item.subreddit,
      sort: item.sort,
      targetPostCount: item.targetPostCount,
      ...flags,
    });
  }

  for (const item of draft.urls) {
    if (!item.enabled) continue;
    if (!item.url) throw new Error('Có một nguồn URL đang bật nhưng chưa nhập đường dẫn.');
    let parsed;
    try {
      parsed = new URL(item.url);
    } catch {
      throw new Error(`Đường dẫn chưa đúng định dạng: ${item.url}`);
    }
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'reddit.com' && !parsed.hostname.endsWith('.reddit.com'))) {
      throw new Error(`Đường dẫn phải thuộc Reddit: ${item.url}`);
    }
    sources.push({
      id: item.id,
      type: 'CUSTOM_URL',
      url: parsed.href,
      targetPostCount: item.targetPostCount,
      ...flags,
    });
  }

  if (sources.length === 0) {
    throw new Error('Hãy bật ít nhất một nguồn trước khi bắt đầu quét.');
  }

  return {
    sources,
    detail: {
      enabled: draft.settings.detailEnabled,
      maxParallelTabs: 2,
      commentsTopN: draft.settings.commentsTopN,
    },
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ [DRAFT_KEY]: collectDraft() });
  }, 250);
}

function updateSelectionSummary() {
  const draft = collectDraft();
  const enabledBuiltins = Object.values(draft.builtins).filter((value) => value.enabled);
  const enabledSubreddits = draft.subreddits.filter((value) => value.enabled && value.subreddit);
  const enabledUrls = draft.urls.filter((value) => value.enabled && value.url);
  const selectedCount = enabledBuiltins.length + enabledSubreddits.length + enabledUrls.length;
  const postCount = [
    ...enabledBuiltins,
    ...enabledSubreddits,
    ...enabledUrls,
  ].reduce((sum, value) => sum + normalizeCount(value.targetPostCount), 0);

  document.querySelector('#builtinSelectedCount').textContent = `${enabledBuiltins.length}/${BUILTIN_FEEDS.length} đang bật`;
  document.querySelector('#selectionTotal').textContent = `${selectedCount} nguồn đã chọn`;
  document.querySelector('#selectionPosts').textContent = `${postCount.toLocaleString('vi-VN')} bài dự kiến`;
}

async function message(payload) {
  return chrome.runtime.sendMessage(payload);
}

function renderConnection(result) {
  const data = result?.data || {};
  const backendOnline = Boolean(data.backendOnline);
  const sessionConnected = Boolean(data.session?.connected);
  const retry = data.retry || {};

  connectionButton.classList.remove('online', 'offline', 'retrying');
  connectionBanner.classList.toggle('connected', backendOnline && sessionConnected);

  if (backendOnline && sessionConnected) {
    connectionButton.classList.add('online');
    connectionLabel.textContent = 'Đã sẵn sàng';
    connectionTitle.textContent = 'Kết nối thành công';
    connectionMessage.textContent = `Đã kết nối Reddit với ${data.session.cookieCount || 0} cookie. Bạn có thể bắt đầu quét.`;
    connectButton.textContent = 'Làm mới kết nối';
    return;
  }

  if (retry.active) {
    connectionButton.classList.add('retrying');
    connectionLabel.textContent = 'Đang kết nối lại…';
    connectionTitle.textContent = backendOnline
      ? 'Đang kết nối tài khoản Reddit'
      : 'Đang kết nối với ứng dụng trên máy';
    const remaining = Math.max(0, Math.ceil((retry.expiresAt - Date.now()) / 60000));
    connectionMessage.textContent = `Tiện ích đang tự thử lại. Thời gian chờ còn khoảng ${remaining} phút.`;
    connectButton.textContent = 'Thử ngay';
    return;
  }

  connectionButton.classList.add('offline');
  connectionLabel.textContent = backendOnline ? 'Chưa kết nối Reddit' : 'Chưa sẵn sàng';
  connectionTitle.textContent = backendOnline
    ? 'Chưa kết nối tài khoản Reddit'
    : 'Ứng dụng trên máy chưa sẵn sàng';
  connectionMessage.textContent = backendOnline
    ? 'Hãy mở một tab Reddit đã đăng nhập, sau đó chọn “Kết nối lại”.'
    : friendlyErrorMessage(result?.error) || 'Hãy bật ứng dụng Reddit Crawl trên máy. Tiện ích sẽ tự thử kết nối lại.';
  connectButton.textContent = 'Kết nối lại';
}

async function refreshConnection(autoConnect = false) {
  const result = await message({ type: autoConnect ? 'AUTO_CONNECT' : 'GET_BACKEND_STATUS' });
  renderConnection(result);
  return result;
}

function setJobBadge(status) {
  jobStatusBadge.className = 'job-badge';
  progressPanel.classList.remove('success', 'warning', 'error', 'active');

  if (status === 'RUNNING' || status === 'QUEUED') {
    jobStatusBadge.classList.add('running');
    progressPanel.classList.add('active');
  } else if (status === 'COMPLETED') {
    jobStatusBadge.classList.add('done');
    progressPanel.classList.add('success');
  } else if (status === 'PARTIAL') {
    jobStatusBadge.classList.add('partial');
    progressPanel.classList.add('warning');
  } else if (status === 'FAILED' || status === 'CANCELLED') {
    jobStatusBadge.classList.add('failed');
    progressPanel.classList.add('error');
  } else {
    jobStatusBadge.classList.add('idle');
  }

  jobStatusBadge.textContent = JOB_LABELS[status] || 'Sẵn sàng';
}

function renderJob(job) {
  setJobBadge(job.status);
  const requested = job.sources.reduce((sum, source) => sum + source.requested, 0);
  const collected = job.sources.reduce((sum, source) => sum + source.collected, 0);
  const done = job.sources.filter((source) => source.status === 'DONE').length;
  progressSummary.classList.remove('hidden');
  progressSummary.innerHTML = `
    <div class="progress-stat"><strong>${collected}</strong><span>bài đã lấy</span></div>
    <div class="progress-stat"><strong>${requested}</strong><span>bài mục tiêu</span></div>
    <div class="progress-stat"><strong>${done}/${job.sources.length}</strong><span>nguồn hoàn tất</span></div>
  `;

  const lines = [
    job.status === 'COMPLETED' ? 'Quét dữ liệu hoàn tất.' : `Trạng thái: ${JOB_LABELS[job.status] || job.status}`,
    `Mã lần quét: ${job.jobId}`,
    '',
    ...job.sources.map((source) => {
      const typeLabel = SOURCE_TYPE_LABELS[source.sourceType] || source.sourceType;
      const statusLabel = SOURCE_STATUS_LABELS[source.status] || source.status;
      const message = source.message ? `\n  ${friendlyErrorMessage(source.message)}` : '';
      return `${typeLabel.padEnd(16)} ${String(source.collected).padStart(4)}/${String(source.requested).padEnd(4)} · ${statusLabel}${message}`;
    }),
  ];

  if (job.outputFile) lines.push('', `Đã lưu kết quả tại: ${job.outputFile}`);
  if (job.error) lines.push('', `Thông báo: ${friendlyErrorMessage(job.error)}`);
  statusText.textContent = lines.join('\n');
}

async function pollJob(jobId) {
  clearInterval(pollTimer);
  const tick = async () => {
    const result = await message({ type: 'GET_JOB', jobId });
    if (!result?.ok) {
      statusText.textContent = friendlyErrorMessage(result?.error);
      return;
    }
    renderJob(result.data);
    if (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(result.data.status)) {
      clearInterval(pollTimer);
      startButton.disabled = false;
    }
  };
  await tick();
  pollTimer = setInterval(() => tick().catch((error) => {
    statusText.textContent = friendlyErrorMessage(error);
  }), 2000);
}

async function startCrawl() {
  const config = buildCrawlConfig();
  await chrome.storage.local.set({
    [DRAFT_KEY]: collectDraft(),
    lastConfig: config,
  });
  startButton.disabled = true;
  setJobBadge('QUEUED');
  statusText.textContent = 'Đang chuẩn bị kết nối và tạo lần quét mới…';
  const result = await message({ type: 'START_CRAWL', payload: config });
  renderConnection(result.connection || { data: { backendOnline: true, session: { connected: true } } });
  if (!result?.ok) {
    startButton.disabled = false;
    throw new Error(friendlyErrorMessage(result?.error));
  }
  await pollJob(result.data.jobId);
}

async function initialize() {
  const stored = await chrome.storage.local.get([DRAFT_KEY, 'lastConfig', 'lastJobId']);
  const draft = stored[DRAFT_KEY] || migrateLastConfig(stored.lastConfig);

  renderBuiltins(draft.builtins);
  for (const item of draft.subreddits || []) addSubreddit(item, false);
  for (const item of draft.urls || []) addUrl(item, false);

  document.querySelector('#detailEnabled').checked = draft.settings?.detailEnabled !== false;
  document.querySelector('#commentsTopN').value = Number(draft.settings?.commentsTopN || 0);
  document.querySelector('#includePromoted').checked = Boolean(draft.settings?.includePromoted);
  document.querySelector('#includePinned').checked = Boolean(draft.settings?.includePinned);
  document.querySelector('#includeNsfw').checked = Boolean(draft.settings?.includeNsfw);

  for (const element of document.querySelectorAll('#detailEnabled, #commentsTopN, #includePromoted, #includePinned, #includeNsfw')) {
    element.addEventListener('input', () => {
      scheduleSave();
      updateSelectionSummary();
    });
  }

  updateEmptyStates();
  updateSelectionSummary();
  await chrome.storage.local.set({ [DRAFT_KEY]: collectDraft() });
  await refreshConnection(true);

  if (stored.lastJobId) {
    await pollJob(stored.lastJobId).catch(() => undefined);
  }
}

document.querySelector('#addSubredditButton').addEventListener('click', () => {
  addSubreddit({ enabled: true, sort: 'NEW', targetPostCount: 50 });
});

document.querySelector('#addUrlButton').addEventListener('click', () => {
  addUrl({ enabled: true, targetPostCount: 50 });
});

connectButton.addEventListener('click', () => {
  refreshConnection(true).catch((error) => {
    renderConnection({ ok: false, error: friendlyErrorMessage(error) });
  });
});

connectionButton.addEventListener('click', () => {
  refreshConnection(true).catch((error) => {
    renderConnection({ ok: false, error: friendlyErrorMessage(error) });
  });
});

startButton.addEventListener('click', () => {
  startCrawl().catch((error) => {
    startButton.disabled = false;
    setJobBadge('FAILED');
    statusText.textContent = friendlyErrorMessage(error);
    refreshConnection(false).catch(() => undefined);
  });
});

initialize().catch((error) => {
  setJobBadge('FAILED');
  statusText.textContent = friendlyErrorMessage(error);
  renderConnection({ ok: false, error: friendlyErrorMessage(error) });
});
