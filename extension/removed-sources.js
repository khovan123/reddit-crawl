(() => {
  const DRAFT_KEY = 'redditCrawlerDraftV2';
  const REMOVED_TYPE = 'LATEST';

  function isRemovedUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      const isReddit =
        url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com');
      const pathname = url.pathname.replace(/\/+$/, '').toLowerCase();
      return isReddit && pathname === '/latest';
    } catch {
      return false;
    }
  }

  function filterConfig(config) {
    if (!config || typeof config !== 'object') return config;
    return {
      ...config,
      sources: Array.isArray(config.sources)
        ? config.sources.filter(
            (source) =>
              source?.type !== REMOVED_TYPE &&
              !(source?.type === 'CUSTOM_URL' && isRemovedUrl(source.url)),
          )
        : config.sources,
    };
  }

  function filterDraft(draft) {
    if (!draft || typeof draft !== 'object') return draft;
    const builtins = { ...(draft.builtins || {}) };
    delete builtins[REMOVED_TYPE];

    return {
      ...draft,
      builtins,
      urls: Array.isArray(draft.urls)
        ? draft.urls.filter((item) => !isRemovedUrl(item?.url))
        : draft.urls,
    };
  }

  async function cleanStoredConfiguration() {
    const stored = await chrome.storage.local.get([DRAFT_KEY, 'lastConfig']);
    const nextDraft = filterDraft(stored[DRAFT_KEY]);
    const nextConfig = filterConfig(stored.lastConfig);
    const changes = {};

    if (stored[DRAFT_KEY]) changes[DRAFT_KEY] = nextDraft;
    if (stored.lastConfig) changes.lastConfig = nextConfig;
    if (Object.keys(changes).length > 0) {
      await chrome.storage.local.set(changes);
    }
  }

  function updateBuiltInCount() {
    const cards = [...document.querySelectorAll('.feed-card')];
    const enabled = cards.filter(
      (item) => item.querySelector('[data-field="enabled"]')?.checked,
    ).length;
    const count = document.querySelector('#builtinSelectedCount');
    if (!count) return;

    const suffix = document.documentElement.lang === 'en' ? 'enabled' : 'đang bật';
    const next = `${enabled}/${cards.length} ${suffix}`;
    if (count.textContent !== next) count.textContent = next;
  }

  function removeLatestFromUi() {
    let changed = false;
    const card = document.querySelector('.feed-card[data-type="LATEST"]');
    if (card) {
      card.remove();
      changed = true;
    }

    for (const row of document.querySelectorAll('.url-row')) {
      const input = row.querySelector('[data-field="url"]');
      if (isRemovedUrl(input?.value)) {
        row.remove();
        changed = true;
      }
    }

    if (changed) {
      globalThis.updateEmptyStates?.();
      globalThis.updateSelectionSummary?.();
      void cleanStoredConfiguration();
    }

    updateBuiltInCount();
  }

  const originalBuildCrawlConfig = globalThis.buildCrawlConfig;
  if (typeof originalBuildCrawlConfig === 'function') {
    globalThis.buildCrawlConfig = function buildCrawlConfigWithoutRemovedSources() {
      return filterConfig(originalBuildCrawlConfig());
    };
  }

  const observer = new MutationObserver(() => removeLatestFromUi());

  function initialize() {
    removeLatestFromUi();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    void cleanStoredConfiguration();
    setTimeout(() => void cleanStoredConfiguration(), 500);
  }

  window.addEventListener('reddit-i18n-changed', removeLatestFromUi);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
