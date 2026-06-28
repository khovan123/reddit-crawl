const API_BASE = 'http://127.0.0.1:47831/api/reddit';
const RETRY_LIMIT = 3;
const RETRY_WINDOW_MS = 5 * 60 * 1000;
const RETRY_ALARM = 'reddit-backend-retry';
const AUTO_CONNECT_ALARM = 'reddit-auto-connect';
const RETRY_STATE_KEY = 'redditBackendRetryState';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CONNECT_SESSION' || message?.type === 'AUTO_CONNECT') {
    ensureConnection(true)
      .then(sendResponse)
      .catch((error) => sendResponse(failedConnectionResponse(error)));
    return true;
  }

  if (message?.type === 'START_CRAWL') {
    startCrawl(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error.message,
        connection: failedConnectionResponse(error),
      }));
    return true;
  }

  if (message?.type === 'GET_JOB') {
    withRetries(
      () => apiFetchOnce(`/crawl/${encodeURIComponent(message.jobId)}`),
      'Đọc trạng thái job',
    )
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_BACKEND_STATUS') {
    ensureConnection(false)
      .then(sendResponse)
      .catch((error) => sendResponse(failedConnectionResponse(error)));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  scheduleAutoConnect();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAutoConnect();
});

chrome.tabs.onActivated.addListener(() => {
  scheduleAutoConnect();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isRedditUrl(tab.url)) {
    scheduleAutoConnect();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_CONNECT_ALARM) {
    ensureConnection(true).catch(() => undefined);
    return;
  }

  if (alarm.name === RETRY_ALARM) {
    continueRetryWindow().catch(() => undefined);
  }
});

function scheduleAutoConnect() {
  chrome.alarms.create(AUTO_CONNECT_ALARM, { delayInMinutes: 0.05 });
}

async function startCrawl(config) {
  const connection = await ensureConnection(true);
  if (!connection.ok || !connection.data?.session?.connected) {
    throw new Error(connection.error || 'Không thể kết nối Reddit session sau 3 lần thử.');
  }

  const data = await withRetries(
    () => apiFetchOnce('/crawl', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
    'Tạo crawl job',
  );

  await chrome.storage.local.set({
    lastJobId: data.jobId,
    lastConfig: config,
  });

  return { ok: true, data, connection };
}

async function ensureConnection(connectSession) {
  let backendOnline = false;
  let session = { connected: false };

  try {
    const health = await withRetries(
      () => apiFetchOnce('/health'),
      'Kết nối backend',
    );
    backendOnline = health?.ok === true;

    session = await withRetries(
      () => apiFetchOnce('/session'),
      'Đọc Reddit session',
    );

    if (connectSession && !session.connected) {
      const connected = await withRetries(
        () => connectCurrentSessionOnce(),
        'Kết nối Reddit session',
      );
      session = {
        connected: true,
        issuedAt: connected.issuedAt,
        sourceUrl: connected.sourceUrl,
        cookieCount: connected.cookieCount,
      };
    }

    await clearRetryWindow();
    return {
      ok: true,
      data: {
        backendOnline,
        session,
        retry: inactiveRetryState(),
      },
    };
  } catch (error) {
    const retry = await activateRetryWindow(error);
    return {
      ok: false,
      data: {
        backendOnline,
        session,
        retry,
      },
      error: error.message,
    };
  }
}

async function connectCurrentSessionOnce() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error('Không tìm thấy tab đang hoạt động.');
  }

  const url = new URL(tab.url);
  if (!isRedditUrl(tab.url) || url.protocol !== 'https:') {
    throw new Error('Hãy mở Reddit trong tab hiện tại để extension lấy session.');
  }

  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((item) => item.tabIds.includes(tab.id));
  if (!store) {
    throw new Error('Không xác định được cookie store của tab Reddit.');
  }

  const cookies = await chrome.cookies.getAll({
    domain: 'reddit.com',
    storeId: store.id,
  });

  if (cookies.length === 0) {
    throw new Error('Không tìm thấy cookie Reddit trong profile hiện tại.');
  }

  const [{ result: browserState }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const localStorageSnapshot = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (value !== null && value.length <= 200000) {
          localStorageSnapshot[key] = value;
        }
      }

      return {
        userAgent: navigator.userAgent,
        locale: navigator.language || 'en-US',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        viewport: {
          width: Math.max(320, window.innerWidth),
          height: Math.max(240, window.innerHeight),
          deviceScaleFactor: window.devicePixelRatio || 1,
        },
        localStorage: localStorageSnapshot,
      };
    },
  });

  if (!browserState) {
    throw new Error('Không đọc được trạng thái trình duyệt từ tab Reddit.');
  }

  const payload = {
    leaseId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    sourceUrl: tab.url,
    cookieStoreId: store.id,
    incognito: Boolean(tab.incognito),
    browser: {
      userAgent: browserState.userAgent,
      locale: browserState.locale,
      timezone: browserState.timezone,
      viewport: browserState.viewport,
    },
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      session: cookie.session,
      expirationDate: cookie.expirationDate,
      partitionKey: cookie.partitionKey?.topLevelSite,
    })),
    localStorage: browserState.localStorage,
  };

  const data = await apiFetchOnce('/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    ...data,
    sourceUrl: tab.url,
  };
}

async function withRetries(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
    await updateRetryAttempt(attempt, label);

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_LIMIT) {
        await sleep(750 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`${label} thất bại sau ${RETRY_LIMIT} lần: ${lastError?.message || lastError}`);
}

async function apiFetchOnce(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Local-Client': 'reddit-crawl-extension',
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message = data?.message || data?.error || data || `HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Backend không phản hồi trong 10 giây.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function activateRetryWindow(error) {
  const now = Date.now();
  const stored = await readRetryState();
  const startedAt = stored.active && stored.expiresAt > now
    ? stored.startedAt
    : now;
  const expiresAt = startedAt + RETRY_WINDOW_MS;

  if (expiresAt <= now) {
    await clearRetryWindow();
    return inactiveRetryState();
  }

  const state = {
    active: true,
    startedAt,
    expiresAt,
    attempt: RETRY_LIMIT,
    lastError: error.message,
    updatedAt: now,
  };
  await chrome.storage.local.set({ [RETRY_STATE_KEY]: state });
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
  return state;
}

async function continueRetryWindow() {
  const state = await readRetryState();
  if (!state.active || state.expiresAt <= Date.now()) {
    await clearRetryWindow();
    return;
  }

  const result = await ensureConnection(true);
  if (!result.ok && state.expiresAt > Date.now()) {
    chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
  }
}

async function updateRetryAttempt(attempt, label) {
  const state = await readRetryState();
  if (!state.active) return;
  await chrome.storage.local.set({
    [RETRY_STATE_KEY]: {
      ...state,
      attempt,
      label,
      updatedAt: Date.now(),
    },
  });
}

async function readRetryState() {
  const stored = await chrome.storage.local.get(RETRY_STATE_KEY);
  return stored[RETRY_STATE_KEY] || inactiveRetryState();
}

async function clearRetryWindow() {
  await chrome.alarms.clear(RETRY_ALARM);
  await chrome.storage.local.set({ [RETRY_STATE_KEY]: inactiveRetryState() });
}

function inactiveRetryState() {
  return {
    active: false,
    startedAt: 0,
    expiresAt: 0,
    attempt: 0,
    lastError: null,
    updatedAt: Date.now(),
  };
}

function failedConnectionResponse(error) {
  return {
    ok: false,
    data: {
      backendOnline: false,
      session: { connected: false },
      retry: {
        ...inactiveRetryState(),
        lastError: error.message,
      },
    },
    error: error.message,
  };
}

function isRedditUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com');
  } catch {
    return false;
  }
}

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
