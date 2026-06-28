(() => {
  const nativeBrowser = globalThis.browser;
  const nativeChrome = globalThis.chrome;
  const api = nativeBrowser ?? nativeChrome;

  if (!api) {
    throw new Error('WebExtension API is unavailable in this browser.');
  }

  globalThis.redditCrawlBrowser = Object.freeze({
    api,
    name: nativeBrowser ? 'firefox' : 'chromium',
    isFirefox: Boolean(nativeBrowser),
    isChromium: !nativeBrowser && Boolean(nativeChrome),
  });

  if (!nativeBrowser) return;

  // The application uses Chrome MV3's Promise style. Firefox exposes the
  // equivalent Promise APIs under `browser`. Prefer replacing the compatibility
  // namespace completely, then patch only the methods in use as a fallback.
  try {
    globalThis.chrome = nativeBrowser;
  } catch {
    // Fall through to the method-level bridge below.
  }

  if (globalThis.chrome === nativeBrowser || !nativeChrome) return;

  const bindMethod = (target, source, method) => {
    if (!target || typeof source?.[method] !== 'function') return;
    try {
      target[method] = source[method].bind(source);
    } catch {
      // A read-only method will be detected by the final compatibility check.
    }
  };

  bindMethod(nativeChrome.runtime, nativeBrowser.runtime, 'sendMessage');
  bindMethod(nativeChrome.runtime, nativeBrowser.runtime, 'getURL');
  bindMethod(nativeChrome.tabs, nativeBrowser.tabs, 'query');
  bindMethod(nativeChrome.cookies, nativeBrowser.cookies, 'getAllCookieStores');
  bindMethod(nativeChrome.cookies, nativeBrowser.cookies, 'getAll');
  bindMethod(nativeChrome.scripting, nativeBrowser.scripting, 'executeScript');
  bindMethod(nativeChrome.alarms, nativeBrowser.alarms, 'create');
  bindMethod(nativeChrome.alarms, nativeBrowser.alarms, 'clear');
  bindMethod(nativeChrome.storage?.local, nativeBrowser.storage?.local, 'get');
  bindMethod(nativeChrome.storage?.local, nativeBrowser.storage?.local, 'set');

  const promiseCheck = nativeChrome.storage?.local?.get?.('__reddit_crawl_compat_check__');
  if (!promiseCheck || typeof promiseCheck.then !== 'function') {
    throw new Error('Firefox WebExtension Promise bridge could not be initialized.');
  }
})();
