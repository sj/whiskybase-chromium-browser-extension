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
 * It also marks the images that link to bottles matched before (a list of
 * bottles in a shop, say) with a small badge: the extension's icon and the
 * bottle's Whiskybase rating. The background answers from what it stored for
 * those pages earlier; nothing is looked up for this.
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

  // --- Bottles matched before, on lists of bottles ----------------------------

  const MARK_DELAY_MS = 1000;
  const BADGE_ATTR = 'data-bottle-lookup';
  // CSS anchor positioning (Chrome 125 and later) keeps a badge on its image
  // however the page moves the image about afterwards.
  const ANCHORS = CSS.supports('anchor-name', '--a');
  let lastAsked = null;
  let markTimer = null;
  let anchorCount = 0;

  // Links that show an image, by href. Without `all`, only those without a badge yet.
  function imageLinks(all) {
    const links = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      if (!a.querySelector('img') || (!all && a.querySelector(`[${BADGE_ATTR}]`))) continue;
      if (!/^https?:/.test(a.href)) continue;
      if (!links.has(a.href)) links.set(a.href, []);
      links.get(a.href).push(a);
    }
    return links;
  }

  function badgeText(bottle) {
    return bottle.rating ? bottle.rating.toFixed(2) : '–';
  }

  // "WB233907: Inchgower Madeira Finish MM (78 ratings)"; the number of ratings
  // is only known once the popup has shown the bottle's details.
  function badgeTitle(bottle) {
    const n = bottle.reviews;
    const ratings = n != null ? ` (${n} ${n === 1 ? 'rating' : 'ratings'})` : !bottle.rating ? ' (no ratings yet)' : '';
    return `WB${bottle.id}: ${bottle.text}${ratings}`;
  }

  // On the image's top left corner. Without anchor positioning it is measured
  // rather than left to CSS, since the box it is placed in may be inline (a
  // plain link round the image), where top/left don't line up with the image;
  // measured again when the image loads or the window is resized, which misses
  // other changes to the page's layout.
  function placeBadge(host) {
    if (ANCHORS) return;
    const img = host.parentElement && host.parentElement.querySelector('img');
    if (!img) return;
    host.style.top = host.style.left = '0px';
    const at = host.getBoundingClientRect();
    const to = img.getBoundingClientRect();
    host.style.top = `${Math.round(to.top - at.top) + 6}px`;
    host.style.left = `${Math.round(to.left - at.left) + 6}px`;
  }

  // The badge is in a shadow root so that the page's styles leave it alone
  // (and the detector, which reads the page's own text, doesn't see it).
  function setImageBadge(a, bottle, icon) {
    let host = a.querySelector(`[${BADGE_ATTR}]`);
    if (!bottle) return void (host && host.remove());
    if (!host) {
      const img = a.querySelector('img');
      const box = img.parentElement.tagName === 'PICTURE' ? img.parentElement.parentElement : img.parentElement;
      host = document.createElement('span');
      host.setAttribute(BADGE_ATTR, '');
      host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647;';
      if (ANCHORS) {
        const name = `--bottle-lookup-${++anchorCount}`;
        img.style.setProperty('anchor-name', name);
        host.style.setProperty('position-anchor', name);
        host.style.top = 'calc(anchor(top) + 6px)';
        host.style.left = 'calc(anchor(left) + 6px)';
      }
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<style>span { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 3px; ' +
        'border-radius: 10px; background: rgba(31, 26, 22, 0.85); color: #fff; ' +
        'font: 600 11px/14px system-ui, sans-serif; white-space: nowrap; } img { width: 14px; height: 14px; }</style>' +
        '<span><img alt=""><b></b></span>';
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      box.append(host);
      img.addEventListener('load', () => placeBadge(host));
    }
    placeBadge(host);
    const root = host.shadowRoot;
    root.querySelector('img').src = icon;
    root.querySelector('b').textContent = badgeText(bottle);
    root.querySelector('span').title = badgeTitle(bottle);
  }

  // `all` also updates the badges already there (a rating may have changed).
  async function markKnown(all) {
    const links = imageLinks(all);
    const hrefs = [...links.keys()];
    const asked = hrefs.join('\n');
    if (!hrefs.length || (!all && asked === lastAsked)) return;
    lastAsked = asked;
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'whisky:known', hrefs });
    } catch (e) {
      return void linkObserver.disconnect(); // extension reloaded or removed
    }
    if (!reply) return;
    for (const [href, anchors] of links) {
      for (const a of anchors) if (reply.known[href] || all) setImageBadge(a, reply.known[href], reply.icon);
    }
  }

  // Lists grow (more results, infinite scrolling), so this one keeps watching.
  const linkObserver = new MutationObserver(() => {
    clearTimeout(markTimer);
    markTimer = setTimeout(() => markKnown(false), MARK_DELAY_MS);
  });
  let placeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(placeBadge), 200);
  });
  // A bottle matched or updated in another tab (one opened from this list in
  // the background, say): its badge appears or changes here straight away.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('known:'))) return;
    clearTimeout(markTimer);
    markTimer = setTimeout(() => markKnown(true), 200);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'whisky:get') {
      sendResponse(msg.rescan || !latest ? scan() : latest);
    }
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  markKnown(false);
  linkObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
