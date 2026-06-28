const sourcesElement = document.querySelector('#sources');
const template = document.querySelector('#sourceTemplate');
const statusText = document.querySelector('#statusText');
const backendStatus = document.querySelector('#backendStatus');
const connectButton = document.querySelector('#connectButton');
const startButton = document.querySelector('#startButton');
let pollTimer = null;

function setConnectionStatus({ backendOnline, sessionConnected, cookieCount }) {
  if (!backendOnline) {
    backendStatus.textContent = 'Backend offline';
    return;
  }

  if (!sessionConnected) {
    backendStatus.textContent = 'Backend online · chưa có session';
    return;
  }

  backendStatus.textContent = cookieCount
    ? `Backend + session OK (${cookieCount} cookies)`
    : 'Backend + session OK';
}

function addSource(values = {}) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.source-card');

  for (const [key, value] of Object.entries(values)) {
    const field = card.querySelector(`[data-field="${key}"]`);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value;
  }

  card.querySelector('[data-action="remove"]').addEventListener('click', () => card.remove());
  card.querySelector('[data-field="type"]').addEventListener('change', () => updateConditionalFields(card));
  updateConditionalFields(card);
  sourcesElement.append(card);
}

function updateConditionalFields(card) {
  const type = card.querySelector('[data-field="type"]').value;
  card.querySelector('.subreddit-field').classList.toggle('hidden', type !== 'SUBREDDIT');
  card.querySelector('.url-field').classList.toggle('hidden', type !== 'CUSTOM_URL');
  card.querySelector('.sort-field').classList.toggle('hidden', type !== 'SUBREDDIT');
}

function collectConfig() {
  const sources = [...sourcesElement.querySelectorAll('.source-card')].map((card, index) => {
    const read = (name) => card.querySelector(`[data-field="${name}"]`);
    const type = read('type').value;
    const source = {
      id: `source-${index + 1}`,
      type,
      targetPostCount: Number(read('targetPostCount').value),
      includePromoted: read('includePromoted').checked,
      includePinned: read('includePinned').checked,
      includeNsfw: read('includeNsfw').checked,
    };

    if (type === 'SUBREDDIT') {
      source.subreddit = read('subreddit').value.trim();
      source.sort = read('sort').value;
    }

    if (type === 'CUSTOM_URL') {
      source.url = read('url').value.trim();
    }

    return source;
  });

  if (sources.length === 0) throw new Error('Hãy thêm ít nhất một nguồn.');
  for (const source of sources) {
    if (!Number.isInteger(source.targetPostCount) || source.targetPostCount < 1) {
      throw new Error('Số bài phải là số nguyên lớn hơn 0.');
    }
    if (source.type === 'SUBREDDIT' && !source.subreddit) {
      throw new Error('Nguồn Subreddit cần tên subreddit.');
    }
    if (source.type === 'CUSTOM_URL' && !source.url) {
      throw new Error('Nguồn URL cần địa chỉ Reddit.');
    }
  }

  return {
    sources,
    detail: {
      enabled: document.querySelector('#detailEnabled').checked,
      maxParallelTabs: 2,
      commentsTopN: Number(document.querySelector('#commentsTopN').value || 0),
    },
  };
}

async function message(payload) {
  return chrome.runtime.sendMessage(payload);
}

async function refreshConnectionStatus() {
  const result = await message({ type: 'GET_BACKEND_STATUS' });

  if (!result?.ok) {
    setConnectionStatus({ backendOnline: false, sessionConnected: false });
    return result;
  }

  setConnectionStatus({
    backendOnline: result.data.backendOnline,
    sessionConnected: Boolean(result.data.session?.connected),
    cookieCount: result.data.session?.cookieCount,
  });

  return result;
}

async function connect() {
  connectButton.disabled = true;
  statusText.textContent = 'Đang đọc session từ tab Reddit hiện tại...';
  const result = await message({ type: 'CONNECT_SESSION' });
  connectButton.disabled = false;
  if (!result?.ok) throw new Error(result?.error || 'Không thể kết nối session.');

  setConnectionStatus({
    backendOnline: true,
    sessionConnected: true,
    cookieCount: result.data.cookieCount,
  });
  statusText.textContent = 'Session đã được gửi tới backend local.';
}

async function start() {
  const config = collectConfig();
  startButton.disabled = true;
  statusText.textContent = 'Đang kết nối session và tạo crawl job...';
  const result = await message({ type: 'START_CRAWL', payload: config });
  if (!result?.ok) {
    startButton.disabled = false;
    throw new Error(result?.error || 'Không thể bắt đầu crawl.');
  }
  await pollJob(result.data.jobId);
}

async function pollJob(jobId) {
  clearInterval(pollTimer);

  const tick = async () => {
    const result = await message({ type: 'GET_JOB', jobId });
    if (!result?.ok) {
      statusText.textContent = result?.error || 'Không đọc được trạng thái job.';
      return;
    }

    const job = result.data;
    const lines = [
      `Job: ${job.jobId}`,
      `Trạng thái: ${job.status}`,
      ...job.sources.map(
        (source) =>
          `${source.sourceType}: ${source.collected}/${source.requested} | scroll ${source.scrollRound} | ${source.status}${source.message ? ` | ${source.message}` : ''}`,
      ),
    ];
    if (job.outputFile) lines.push(`File: ${job.outputFile}`);
    if (job.error) lines.push(`Lỗi: ${job.error}`);
    statusText.textContent = lines.join('\n');

    if (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(job.status)) {
      clearInterval(pollTimer);
      startButton.disabled = false;
    }
  };

  await tick();
  pollTimer = setInterval(() => tick().catch((error) => {
    statusText.textContent = error.message;
  }), 2000);
}

connectButton.addEventListener('click', () => connect().catch((error) => {
  connectButton.disabled = false;
  statusText.textContent = error.message;
  refreshConnectionStatus().catch(() => undefined);
}));

document.querySelector('#addSourceButton').addEventListener('click', () => addSource({
  type: 'SUBREDDIT',
  targetPostCount: 50,
  sort: 'NEW',
}));

startButton.addEventListener('click', () => start().catch((error) => {
  startButton.disabled = false;
  statusText.textContent = error.message;
}));

async function initialize() {
  const stored = await chrome.storage.local.get(['lastConfig', 'lastJobId']);
  const initialSources = stored.lastConfig?.sources ?? [
    { type: 'HOME', targetPostCount: 50 },
    { type: 'POPULAR', targetPostCount: 50 },
    { type: 'NEWS', targetPostCount: 50 },
    { type: 'BEST', targetPostCount: 50 },
    { type: 'SUBREDDIT', subreddit: 'smallbusiness', targetPostCount: 100, sort: 'NEW' },
  ];
  initialSources.forEach(addSource);

  const connection = await refreshConnectionStatus();
  if (connection?.ok && connection.data.backendOnline && !connection.data.session?.connected) {
    statusText.textContent = 'Backend đang chạy. Hãy mở tab Reddit đã đăng nhập rồi nhấn “Kết nối session”.';
  }

  if (stored.lastJobId) {
    await pollJob(stored.lastJobId).catch(() => undefined);
  }
}

initialize().catch((error) => {
  setConnectionStatus({ backendOnline: false, sessionConnected: false });
  statusText.textContent = error.message;
});
