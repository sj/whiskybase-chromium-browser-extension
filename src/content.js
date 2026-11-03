/*
 * Content script: runs the detector on the page, reports the result to the
 * background worker (for the toolbar badge) and answers the popup.
 *
 * Pages that render late or navigate client-side (SPAs) are re-scanned after
 * DOM changes: always when the URL changed, otherwise only during the first
 * few seconds after load.
 */
(() => {
  'use strict';

  const RESCAN_DELAY_MS = 800;
  const SETTLE_WINDOW_MS = 15000;

  let latest = null;
  let lastReported = null;
  let lastUrl = location.href;
  let windowStart = Date.now();
  let timer = null;

  function scan() {
    latest = globalThis.WhiskyDetector.detect(document, { url: location.href });
    const key = JSON.stringify([latest.url, latest.status, latest.whisky.name]);
    if (key !== lastReported) {
      lastReported = key;
      console.debug('[Whiskybase Chromium Browser Extension]', latest.status, latest);
      try {
        chrome.runtime.sendMessage({ type: 'whisky:detection', result: latest }).catch(() => {});
      } catch (e) {
        // Extension was reloaded or removed; this script is orphaned.
        observer.disconnect();
      }
    }
    return latest;
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      windowStart = Date.now();
    } else if (Date.now() - windowStart > SETTLE_WINDOW_MS) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(scan, RESCAN_DELAY_MS);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'whisky:get') {
      sendResponse(msg.rescan || !latest ? scan() : latest);
    }
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
