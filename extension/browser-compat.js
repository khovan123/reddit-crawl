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

  // The current extension code uses the Chrome MV3 Promise style. Firefox
  // exposes the same APIs through `browser` with Promises, so point the
  // compatibility namespace at `browser` before loading the application code.
  if (nativeBrowser) {
    try {
      globalThis.chrome = nativeBrowser;
    } catch {
      // Firefox normally allows this assignment. Keep a diagnostic global so
      // future code can use redditCrawlBrowser.api directly if that changes.
    }
  }
})();
