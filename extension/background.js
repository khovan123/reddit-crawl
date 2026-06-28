const API_BASE = 'http://127.0.0.1:47831/api/reddit';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CONNECT_SESSION') {
    connectCurrentSession()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'START_CRAWL') {
    startCrawl(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_JOB') {
    apiFetch(`/crawl/${encodeURIComponent(message.jobId)}`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_BACKEND_STATUS') {
    Promise.all([apiFetch('/health'), apiFetch('/session')])
      .then(([health, session]) =>
        sendResponse({
          ok: true,
          data: {
            backendOnline: health?.ok === true,
            session,
          },
        }),
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          data: {
            backendOnline: false,
            session: { connected: false },
          },
          error: error.message,
        }),
      );
    return true;
  }

  if (message?.type === 'GET_SESSION_STATUS') {
    apiFetch('/session')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function startCrawl(config) {
  await connectCurrentSession();
  const data = await apiFetch('/crawl', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  await chrome.storage.local.set({ lastJobId: data.jobId, lastConfig: config });
  return { ok: true, data };
}

async function connectCurrentSession() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error('Không tìm thấy tab đang hoạt động.');
  }

  const url = new URL(tab.url);
  if (url.protocol !== 'https:' || (url.hostname !== 'reddit.com' && !url.hostname.endsWith('.reddit.com'))) {
    throw new Error('Hãy mở Reddit trong tab hiện tại trước khi kết nối session.');
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

  const data = await apiFetch('/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return { ok: true, data };
}

async function apiFetch(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
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
}
