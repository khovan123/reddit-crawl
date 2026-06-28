(() => {
  const STORAGE_KEY = 'redditCrawlerLocale';
  let locale = 'vi';
  let dictionaries = { vi: {}, en: {} };
  let dynamicEn = {};
  let observer;
  const originals = new WeakMap();

  async function loadJson(path) {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.json();
  }

  const t = (key) => dictionaries[locale]?.[key] ?? dictionaries.vi[key] ?? key;

  function translateText(source) {
    if (locale === 'vi') return source;
    let output = dynamicEn[source] ?? source;
    const rules = [
      [/^(\d+)\/(\d+) đang bật$/, '$1/$2 enabled'],
      [/^(\d+) nguồn đã chọn$/, '$1 sources selected'],
      [/^([\d.,]+) bài dự kiến$/, '$1 planned posts'],
      [/^Đã kết nối Reddit với (\d+) cookie\. Bạn có thể bắt đầu quét\.$/, 'Connected to Reddit with $1 cookies. You can start crawling.'],
      [/^Tiện ích đang tự thử lại\. Thời gian chờ còn khoảng (\d+) phút\.$/, 'The extension is retrying automatically. About $1 minutes remain.'],
      [/^Mã lần quét: /, 'Crawl ID: '],
      [/^Trạng thái: /, 'Status: '],
      [/^Đã lưu kết quả tại: /, 'Results saved to: '],
      [/^Thông báo: /, 'Message: ']
    ];
    for (const [pattern, replacement] of rules) output = output.replace(pattern, replacement);
    for (const [from, to] of Object.entries(dynamicEn)) output = output.replaceAll(from, to);
    return output;
  }

  function query(root, selector) {
    return [
      ...(root instanceof Element && root.matches(selector) ? [root] : []),
      ...(root.querySelectorAll?.(selector) ?? [])
    ];
  }

  function applyStatic(root = document) {
    for (const el of query(root, '[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of query(root, '[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of query(root, '[data-i18n-aria-label]')) {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    }
  }

  function skip(node) {
    const parent = node.parentElement;
    return !parent || !node.nodeValue?.trim() || parent.closest('script, style, [data-i18n]');
  }

  function walk(root, callback) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) callback(node);
  }

  function remember(root = document) {
    walk(root, (node) => {
      if (!skip(node) && !originals.has(node)) originals.set(node, node.nodeValue);
    });
  }

  function applyDynamic(root = document) {
    walk(root, (node) => {
      if (skip(node)) return;
      if (!originals.has(node)) originals.set(node, node.nodeValue);
      node.nodeValue = translateText(originals.get(node));
    });
  }

  function updateButton() {
    const button = document.querySelector('#languageToggle');
    if (!button) return;
    button.textContent = locale === 'vi' ? 'EN' : 'VI';
    button.title = t('language.switch');
    button.setAttribute('aria-label', t('language.switch'));
  }

  function observe() {
    observer ??= new MutationObserver((mutations) => {
      observer.disconnect();
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') originals.set(mutation.target, mutation.target.nodeValue);
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) originals.set(node, node.nodeValue);
          if (node.nodeType === Node.ELEMENT_NODE) {
            applyStatic(node);
            remember(node);
          }
        }
      }
      applyDynamic(document);
      observe();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function apply() {
    observer?.disconnect();
    applyStatic(document);
    remember(document);
    applyDynamic(document);
    document.documentElement.lang = locale;
    updateButton();
    observe();
  }

  async function setLocale(next) {
    locale = next === 'en' ? 'en' : 'vi';
    await chrome.storage.local.set({ [STORAGE_KEY]: locale });
    apply();
    window.dispatchEvent(
      new CustomEvent('reddit-i18n-changed', { detail: { locale } }),
    );
  }

  function loadPopupScript(path, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(path);
    script.dataset[marker] = 'true';
    document.head.append(script);
  }

  function loadPopupEnhancements() {
    loadPopupScript('job-results.js', 'jobResults');
    loadPopupScript('removed-sources.js', 'removedSources');
  }

  async function init() {
    [dictionaries.vi, dictionaries.en, dynamicEn] = await Promise.all([
      loadJson('locales/vi.json'),
      loadJson('locales/en.json'),
      loadJson('locales/dynamic-en.json')
    ]);
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    locale = stored[STORAGE_KEY] === 'en' ? 'en' : 'vi';
    apply();
    loadPopupEnhancements();
    document.querySelector('#languageToggle')?.addEventListener('click', () => {
      void setLocale(locale === 'vi' ? 'en' : 'vi');
    });
  }

  window.RedditI18n = { t, apply, setLocale, getLocale: () => locale };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  } else {
    void init();
  }
})();
