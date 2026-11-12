/*
 * Content script: runs the detector on the page, reports the result to the
 * background worker (for the toolbar badge) and answers the popup.
 *
 * It is loaded by the popup when the toolbar icon is clicked, and on every
 * page when automatic checking is on; a page that gets it twice keeps one copy.
 *
 * Pages that render late or navigate client-side (SPAs) are re-scanned after
 * DOM changes: always when the URL changed, otherwise only during the first
 * few seconds after load. Each such wait runs from the first change, not the
 * last: on a page that changes all the time (a clock ticking every 200ms) a
 * wait restarted by every change would never end.
 *
 * It also marks the images that link to bottles matched before (a list of
 * bottles in a shop, say) with a small badge: the extension's icon and the
 * bottle's Whiskybase rating. The background answers from what it stored for
 * those pages earlier; nothing is looked up for this. A page whose own bottle
 * was matched gets the same badge on its photo.
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

  // The address the page gives as its own (rel=canonical): a match is also
  // stored under it, as a list of bottles may link there instead.
  function canonicalUrl() {
    const link = document.querySelector('link[rel="canonical"][href]');
    try {
      return link ? new URL(link.getAttribute('href'), location.href).href : null;
    } catch (e) {
      return null;
    }
  }

  function scan() {
    latest = { ...globalThis.WhiskyDetector.detect(document, { url: location.href }), canonical: canonicalUrl() };
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
    showTitleIcon();
    return latest;
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      windowStart = Date.now();
      refreshPageBottle();
    } else if (Date.now() - windowStart > SETTLE_WINDOW_MS) {
      return;
    }
    timer ||= setTimeout(() => {
      timer = null;
      scan();
    }, RESCAN_DELAY_MS);
  });

  // --- Bottles matched before, on lists of bottles ----------------------------

  const MARK_DELAY_MS = 1000;
  const BADGE_ATTR = 'data-bottle-lookup';
  const PAGE_BADGE_ATTR = 'data-bottle-lookup-page';
  const ALL_BADGES = `[${BADGE_ATTR}], [${PAGE_BADGE_ATTR}]`;
  // CSS anchor positioning (Chrome 125 and later) keeps a badge on its image
  // however the page moves the image about afterwards.
  const ANCHORS = CSS.supports('anchor-name', '--a');
  let lastAsked = null;
  let markTimer = null;
  let knownTimer = null;
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

  const badgeImages = new WeakMap(); // badge → the image it is placed on

  // The bottle's photo: the largest image in the link, as a link round a card
  // may have small ones too (a "Free delivery" label's icon, say). By the size
  // on the page, or else the size the page gives it, for one not laid out yet.
  function photo(a) {
    let best = null;
    let bestArea = -1;
    for (const img of a.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height || (+img.getAttribute('width') || 0) * (+img.getAttribute('height') || 0);
      if (area > bestArea) [best, bestArea] = [img, area];
    }
    return best;
  }

  // Centred at the bottom of the image, 6px up from its bottom edge. Without
  // anchor positioning it is measured rather than left to CSS, since the box it
  // is placed in may be inline (a plain link round the image), where top/left
  // don't line up with the image; measured again when the image loads or the
  // window is resized, which misses other changes to the page's layout.
  function placeBadge(host) {
    if (ANCHORS) return;
    const img = badgeImages.get(host);
    if (!img || !img.isConnected) return;
    host.style.top = host.style.left = '0px';
    const at = host.getBoundingClientRect();
    const to = img.getBoundingClientRect();
    host.style.top = `${Math.round(to.bottom - at.top - at.height) - 6}px`;
    host.style.left = `${Math.round(to.left - at.left + (to.width - at.width) / 2)}px`;
  }

  // Faint and grey on the photo, in the icon's colours when the pointer is on it.
  const BADGE_HTML =
    '<style>span { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 3px; ' +
    'border-radius: 10px; background: rgba(255, 255, 255, 0.55); color: rgba(43, 33, 24, 0.7); ' +
    'box-shadow: 0 0 0 1px rgba(43, 33, 24, 0.12); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); ' +
    'font: 600 11px/14px system-ui, sans-serif; white-space: nowrap; cursor: pointer; ' +
    'transition: background 0.15s, color 0.15s, box-shadow 0.15s; } ' +
    'img { width: 14px; height: 14px; filter: grayscale(1); opacity: 0.45; transition: filter 0.15s, opacity 0.15s; } ' +
    'span:hover { background: #7a3e12; color: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); } ' +
    'span:hover img { filter: none; opacity: 1; }</style>' +
    '<span><img alt=""><b></b></span>';

  // The badge is in a shadow root so that the page's styles leave it alone
  // (and the detector, which reads the page's own text, doesn't see it).
  // Clicked: `onClick`, instead of a link round the image being followed.
  function addBadge(img, attr, onClick) {
    const box = img.parentElement.tagName === 'PICTURE' ? img.parentElement.parentElement : img.parentElement;
    const host = document.createElement('span');
    host.setAttribute(attr, '');
    badgeImages.set(host, img);
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647;';
    if (ANCHORS) {
      const name = `--bottle-lookup-${++anchorCount}`;
      img.style.setProperty('anchor-name', name);
      host.style.setProperty('position-anchor', name);
      host.style.bottom = 'calc(anchor(bottom) + 6px)';
      host.style.left = 'anchor(center)';
      host.style.transform = 'translateX(-50%)';
    }
    host.attachShadow({ mode: 'open' }).innerHTML = BADGE_HTML;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.append(host);
    img.addEventListener('load', () => placeBadge(host));
    host.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return host;
  }

  function fillBadge(host, bottle, icon) {
    const root = host.shadowRoot;
    root.querySelector('img').src = icon;
    root.querySelector('b').textContent = badgeText(bottle);
    root.querySelector('span').title = badgeTitle(bottle);
    placeBadge(host); // once it has its content, as its width counts
  }

  // Clicked: the popup opens on this bottle.
  function setImageBadge(a, bottle, icon) {
    let host = a.querySelector(`[${BADGE_ATTR}]`);
    if (!bottle) return void (host && host.remove());
    host ||= addBadge(photo(a), BADGE_ATTR, () =>
      chrome.runtime.sendMessage({ type: 'whisky:show-known', href: a.href }).catch(() => {})
    );
    fillBadge(host, bottle, icon);
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
      reply = await chrome.runtime.sendMessage({ type: 'whisky:known', hrefs, canonical: canonicalUrl() });
    } catch (e) {
      return void linkObserver.disconnect(); // extension reloaded or removed
    }
    if (!reply) return;
    for (const [href, anchors] of links) {
      for (const a of anchors) if (reply.known[href] || all) setImageBadge(a, reply.known[href], reply.icon);
    }
  }

  // Lists grow (more results, infinite scrolling), so this one keeps watching.
  // New links and photos come as elements; changes to text alone (a clock on
  // the page) are left out.
  const linkObserver = new MutationObserver((records) => {
    if (!records.some((r) => [...r.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE))) return;
    markTimer ||= setTimeout(() => {
      markTimer = null;
      markKnown(false);
      placePageBadge(); // the photo may have been added or replaced
    }, MARK_DELAY_MS);
  });
  let placeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => {
      document.querySelectorAll(ALL_BADGES).forEach(placeBadge);
      showTitleIcon(); // another title may be shown at this width
    }, 200);
  });
  // A bottle matched or updated in another tab (one opened from this list in
  // the background, say): its badge appears or changes here straight away.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('known:'))) return;
    clearTimeout(knownTimer);
    knownTimer = setTimeout(() => {
      markKnown(true);
      refreshPageBottle();
    }, 200);
  });

  // --- The page's own bottle, matched before -----------------------------------

  let pageBottle = null; // { bottle, icon } stored for this page's address

  // An image's area if it can be the bottle's photo: shown, at least 120px each
  // way and not a wide banner, outside the header, menus and footer. By its size
  // in the layout, so that a transform doesn't count: a zoom on hover (Master of
  // Malt) adds a copy of the photo, enlarged, which stays when made invisible.
  function photoArea(img) {
    if (!img.isConnected || img.closest('header, nav, footer')) return 0;
    if (img.checkVisibility && !img.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return 0;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    return w >= 120 && h >= 120 && w <= 2 * h ? w * h : 0;
  }

  // The bottle's photo: the largest image on the page. The badge stays on the
  // one it is on unless another is larger, and the first of the same size wins.
  function mainPhoto() {
    const host = document.querySelector(`[${PAGE_BADGE_ATTR}]`);
    let best = host && badgeImages.get(host);
    let bestArea = best ? photoArea(best) : 0;
    if (!bestArea) best = null;
    for (const img of document.images) {
      const area = photoArea(img);
      if (area > bestArea) [best, bestArea] = [img, area];
    }
    return best;
  }

  // Clicked: the popup opens, as for a click on the toolbar icon.
  function placePageBadge() {
    let host = document.querySelector(`[${PAGE_BADGE_ATTR}]`);
    const img = pageBottle && mainPhoto();
    if (host && badgeImages.get(host) !== img) host = void host.remove();
    if (!img) return;
    host ||= addBadge(img, PAGE_BADGE_ATTR, () => chrome.runtime.sendMessage({ type: 'whisky:open-popup' }).catch(() => {}));
    fillBadge(host, pageBottle.bottle, pageBottle.icon);
  }

  // A photo has no size until it loads (a lazy one, say), and that changes
  // nothing the observers see: until there is a badge, each loaded image counts.
  let photoTimer = null;
  document.addEventListener(
    'load',
    (e) => {
      if (!pageBottle || e.target.tagName !== 'IMG' || document.querySelector(`[${PAGE_BADGE_ATTR}]`)) return;
      clearTimeout(photoTimer);
      photoTimer = setTimeout(placePageBadge, 200);
    },
    true
  );

  async function refreshPageBottle() {
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'whisky:own-known' });
    } catch (e) {
      // extension reloaded or removed
    }
    pageBottle = reply && reply.bottle ? reply : null;
    placePageBadge();
    showTitleIcon(); // its tooltip says whether there is a match
  }

  // --- An icon after the bottle's title ----------------------------------------

  const TITLE_ATTR = 'data-bottle-lookup-title';
  // The icon's Glencairn glass without its square, for any backdrop: a dark
  // line inside a light halo, so that it shows on light and dark ones alike.
  const GLASS =
    'M8.6 2.6H15.4C15.3 4.6 14.6 6.2 14.8 7.9C15.1 10 17.7 11.1 17.7 13.9C17.7 16.3 15.6 17.5 13.1 17.7V19.4' +
    'C15.1 19.6 16.5 20 16.5 20.6C16.5 21.3 7.5 21.3 7.5 20.6C7.5 20 8.9 19.6 10.9 19.4V17.7' +
    'C8.4 17.5 6.3 16.3 6.3 13.9C6.3 11.1 8.9 10 9.2 7.9C9.4 6.2 8.7 4.6 8.6 2.6Z';
  const GLASS_SVG =
    '<svg viewBox="0 0 24 24" role="img"><title></title>' +
    `<path d="${GLASS}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/>` +
    `<path d="${GLASS}" fill="rgba(255, 255, 255, 0.18)" stroke="#2b2118" stroke-width="1.2" stroke-linejoin="round"/>` +
    '<path d="M7.25 13.1H16.75C16.8 15.6 14.9 16.75 12 16.75C9.1 16.75 7.2 15.6 7.25 13.1Z" fill="#e39b2d"/></svg>';

  function bottleShown() {
    return !!latest && latest.status !== 'none';
  }

  // While a bottle is detected, the page's title ends in a very faint grey copy
  // of the extension's icon, which opens the popup. It is in a shadow root, so
  // that the detector (which reads the title) doesn't see it.
  function showTitleIcon() {
    let host = document.querySelector(`[${TITLE_ATTR}]`);
    // The first title that is shown: of one for phones and one for larger
    // screens (Majestic), the other is hidden.
    const title = bottleShown() && globalThis.WhiskyDetector.mainHeadingElements(document).find((h) => h.checkVisibility());
    if (host && host.parentElement !== title) host = void host.remove();
    if (!title) return;
    if (!host) {
      host = document.createElement('span');
      host.setAttribute(TITLE_ATTR, '');
      host.style.cssText = 'display: inline; position: static; float: none; margin: 0; padding: 0; border: 0;';
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<style>svg { width: max(14px, 0.66em); height: max(14px, 0.66em); margin-left: 0.35em; ' +
        'vertical-align: middle; opacity: 0.35; filter: grayscale(1); cursor: pointer; ' +
        'transition: opacity 0.15s, filter 0.15s; } svg:hover { opacity: 0.9; filter: none; }</style>' +
        GLASS_SVG;
      // The title may be inside a link: the popup opens instead.
      host.shadowRoot.querySelector('svg').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'whisky:open-popup' }).catch(() => {});
      });
      title.append(host);
    }
    host.shadowRoot.querySelector('title').textContent = pageBottle
      ? 'Bottle information detected and matched to Whiskybase. Click to see more in browser extension.'
      : 'Bottle information detected. Click to see more in browser extension.';
  }


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
    // A little smaller than the text round it, and a long name cut short with
    // an ellipsis ("(Highland P…)"), so that it fits a narrow table cell.
    const note = document.createElement('span');
    note.style.cssText = 'opacity: 0.75; font-size: 0.85em; white-space: nowrap;';
    const name = document.createElement('span');
    name.style.cssText =
      'display: inline-block; max-width: 6em; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;';
    name.textContent = distillery;
    note.append(' (', name, ')');
    note.title = `SMWS distillery ${code.split('.')[0]}: ${distillery} (added by Bottle lookup for Whiskybase)`;
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
    smwsTimer ||= setTimeout(() => {
      smwsTimer = null;
      annotateSmws();
    }, SMWS_DELAY_MS);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'whisky:get') {
      sendResponse(msg.rescan || !latest ? scan() : latest);
    }
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  markKnown(false);
  refreshPageBottle();
  linkObserver.observe(document.documentElement, { childList: true, subtree: true });
  if (globalThis.SmwsCodes && globalThis.SmwsCodes.isSmwsSite(location.hostname)) {
    annotateSmws();
    smwsObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
