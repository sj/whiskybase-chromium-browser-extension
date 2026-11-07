/*
 * Content script: runs the detector on the page, reports the result to the
 * background worker (for the toolbar badge) and answers the popup.
 *
 * It is loaded by the popup when the toolbar icon is clicked, and on every
 * page when automatic checking is on; a page that gets it twice keeps one copy.
 *
 * Pages that render late or navigate client-side (SPAs) are re-scanned after
 * DOM changes: always when the URL changed, otherwise only during the first
 * few seconds after load.
 *
 * On smws.com, it also adds the distillery's name after each of the Society's
 * bottle codes ("3.369 (Bowmore)").
 */
(() => {
  'use strict';

  // An earlier copy counts only while its extension is still running: after a
  // reload of the extension, its runtime loses its id and the new copy takes over.
  const earlier = globalThis.__bottleLookupRuntime;
  if (earlier && earlier.id) return;
  // Whiskybase's own pages have nothing to look up (and include the extension's search tabs).
  if (/(?:^|\.)whiskybase\.com$/i.test(location.hostname)) return;
  globalThis.__bottleLookupRuntime = chrome.runtime;

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
      console.debug('[Bottle lookup for Whiskybase]', latest.status, latest);
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

  // --- SMWS codes, on smws.com -----------------------------------------------

  const SMWS_ATTR = 'data-bottle-lookup-smws';
  const SMWS_DELAY_MS = 500;
  const SKIP_TEXT = `script, style, noscript, textarea, select, [contenteditable], [${SMWS_ATTR}]`;
  let smwsTimer = null;

  // The name is in a shadow root, so that the detector (which reads the page's
  // own text) doesn't see it; it takes the font and colour of the text round it.
  function smwsNote(code, distillery) {
    const host = document.createElement('span');
    host.setAttribute(SMWS_ATTR, code);
    host.style.cssText = 'display: inline; position: static; float: none; margin: 0; padding: 0; border: 0;';
    const note = document.createElement('span');
    note.style.opacity = '0.75';
    note.textContent = ` (${distillery})`;
    note.title = `SMWS code ${code.split('.')[0]}: ${distillery} (added by Bottle lookup for Whiskybase)`;
    host.attachShadow({ mode: 'open' }).append(note);
    return host;
  }

  // Each code is followed by its note; a code that has one already is left alone.
  function annotateSmws() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\d\.\d/.test(n.data) && !n.parentElement.closest(SKIP_TEXT)) nodes.push(n);
    }
    for (const node of nodes) {
      // Last first, so that splitting the text leaves the earlier positions as they are.
      for (const c of globalThis.SmwsCodes.findCodes(node.data).reverse()) {
        const next = c.end === node.data.length ? node.nextSibling : null;
        if (next && next.nodeType === 1 && next.getAttribute(SMWS_ATTR) === c.code) continue;
        node.splitText(c.end).before(smwsNote(c.code, c.distillery));
      }
    }
  }

  // Pages fill in later (the Society's lists of bottles load after the page),
  // so this one keeps watching.
  const smwsObserver = new MutationObserver(() => {
    clearTimeout(smwsTimer);
    smwsTimer = setTimeout(annotateSmws, SMWS_DELAY_MS);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'whisky:get') {
      sendResponse(msg.rescan || !latest ? scan() : latest);
    }
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (globalThis.SmwsCodes && globalThis.SmwsCodes.isSmwsSite(location.hostname)) {
    annotateSmws();
    smwsObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
