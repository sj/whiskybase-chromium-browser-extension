/*
 * Background service worker:
 *  - when automatic checking is on (the user granted access to all sites),
 *    keeps the detector registered as a content script on every page;
 *  - shows the detection result as a per-tab badge on the toolbar icon
 *    (Chrome resets tab-specific badges on navigation);
 *  - for confident detections, looks the bottle up on Whiskybase and stores
 *    the outcome per tab in chrome.storage.session, where the popup reads it;
 *  - when Cloudflare stops a search, opens it in a tab for the user and reads
 *    the results from that tab once they load; while the checks go on, that
 *    tab (while it stays on Whiskybase) does the requests instead.
 *
 * Debugging: `chrome.storage.local.set({ debugSimulateCloudflareBlock: true })` in this
 * worker's DevTools console makes every Whiskybase page request act as if
 * Cloudflare stopped it (see DEVELOPMENT.md); `false` turns it off again.
 */
'use strict';

importScripts('whiskybase.js');

const BADGES = {
  match: { text: 'WB', color: '#1f5fa8', title: 'Found on Whiskybase' },
  whisky: { text: '✓', color: '#2e7d32', title: 'Whisky bottle detected' },
  possible: { text: '?', color: '#c77700', title: 'Possibly a whisky bottle' },
  none: { text: '', color: '#777777', title: 'No whisky bottle detected' },
};

const AUTO_MIN_CONFIDENCE = 0.9; // detections below this are only searched on request
const CACHE_MS = 60 * 60 * 1000; // reuse a search result for an hour
const MIN_GAP_MS = 3000; // at least this long between requests to Whiskybase
const BLOCKED_PAUSE_MS = 2 * 60 * 1000; // no requests of the background's own this long after a Cloudflare check

// Last page URL reported per tab, to drop lookups that finish after navigating away.
const pageUrls = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

function setBadge(tabId, key, name) {
  const badge = BADGES[key] || BADGES.none;
  const title = key === 'none' ? badge.title : `${badge.title}: ${name}`;
  chrome.action.setBadgeText({ tabId, text: badge.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  chrome.action.setTitle({ tabId, title: `Bottle lookup for Whiskybase – ${title}` });
}

// ---------------------------------------------------------------------------
// Whiskybase search: cached, throttled, one request at a time

async function simulatingBlocks() {
  return !!(await chrome.storage.local.get('debugSimulateCloudflareBlock')).debugSimulateCloudflareBlock;
}

/** Fetches a Whiskybase page and runs `analyse` on its HTML; 'blocked' on a Cloudflare check. */
async function fetchPage(url, analyse) {
  if (await simulatingBlocks()) return { state: 'blocked', url, status: 403 };
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  try {
    const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
    const page = analyse(await res.text());
    if (page.challenge || res.headers.get('cf-mitigated')) return { state: 'blocked', url, status: res.status };
    if (!res.ok) return { state: 'error', url, status: res.status, error: `HTTP ${res.status}` };
    return { state: 'ok', url, status: res.status, page };
  } catch (e) {
    return { state: 'error', url, error: String(e) };
  }
}

async function pausedAfterCheck() {
  const { blockedAt } = await chrome.storage.session.get('blockedAt');
  return !!blockedAt && Date.now() - blockedAt < BLOCKED_PAUSE_MS;
}

/**
 * Cached, throttled, one-at-a-time fetch; `analyse` must return plain data.
 * When Cloudflare stops the request, or requests are paused after a check, the
 * helper tab (below) does it instead if there is one.
 */
async function cachedFetch(key, url, analyse) {
  const cached = (await chrome.storage.session.get(key))[key];
  // While simulating blocks, cached pages would hide them.
  if (cached && Date.now() - cached.at < CACHE_MS && !(await simulatingBlocks())) return { ...cached.value, cached: true };

  const run = queue.then(async () => {
    const direct = (await pausedAfterCheck()) ? { state: 'blocked', url, paused: true } : await fetchPage(url, analyse);
    if (direct.state !== 'blocked') return direct;
    if (!direct.paused) await chrome.storage.session.set({ blockedAt: Date.now() });
    return (await fetchInHelperTab(url, analyse)) || direct;
  });
  queue = run.catch(() => {});
  const value = await run;
  if (value.state === 'ok') await chrome.storage.session.set({ [key]: { at: Date.now(), value } });
  return value;
}

async function search(query) {
  const r = await cachedFetch(`search:${query}`, Whiskybase.searchUrl(query), Whiskybase.analyseSearchHtml);
  return r.state === 'ok' ? { ...r, total: r.page.total, results: r.page.whiskies } : r;
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Image type from the first bytes, for servers that send a generic content type. */
function sniffImageType(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  return null;
}

async function fetchPhoto(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return { error: `too large (${Math.round(bytes.length / 1024)} kB)` };
    const header = (res.headers.get('content-type') || '').split(';')[0].trim();
    const type = header.startsWith('image/') ? header : sniffImageType(bytes);
    if (!type) return { error: `not an image (${header || 'no content type'})` };
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: `data:${type};base64,${btoa(bin)}` };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * The bottle photo as a data: URL, trying each candidate URL and its other
 * sizes. Whiskybase's image host is behind Cloudflare too, so photos are
 * fetched like the pages (with the browser's cookies) rather than loaded by
 * the popup directly. Returns { url, data } or { note } saying why there is none.
 */
async function photoData(urls) {
  const tried = [...new Set(urls.filter(Boolean).flatMap(Whiskybase.photoVariants))];
  if (!tried.length) return { note: 'Whiskybase has no photo of this bottle.' };
  let error = '';
  for (const url of tried) {
    const key = `photo:${url}`;
    const cached = (await chrome.storage.session.get(key))[key];
    if (cached) return { url, data: cached };
    const r = await fetchPhoto(url);
    if (r.data) {
      await chrome.storage.session.set({ [key]: r.data });
      return { url, data: r.data };
    }
    error = error || r.error;
  }
  return { url: tried[0], note: `The Whiskybase photo could not be loaded: ${error}.` };
}

/**
 * Rating, number of ratings, shop price and photo from the bottle's own page,
 * plus a note saying why the review count or price is missing, if it is.
 */
async function bottleDetails(match) {
  const r = await cachedFetch(`bottle:${match.id}`, match.url, Whiskybase.analyseBottleHtml);
  if (r.state !== 'ok') {
    const why = r.state === 'blocked' ? 'a Cloudflare check' : r.error || 'unknown error';
    return { note: `The Whiskybase bottle page could not be loaded (${why}), so the number of reviews and the price estimate are missing.` };
  }
  return { ...r.page, note: r.page.price ? null : missingPriceNote(r.page) };
}

function missingPriceNote(page) {
  if (!page.signedIn) {
    return 'No price estimate: Whiskybase sent the bottle page as to a signed-out visitor, without shop prices. Are you signed in on whiskybase.com in this browser?';
  }
  if (!page.priceBlock) return 'No price estimate: the Whiskybase bottle page has no Average Shop Price on it.';
  return 'No price estimate: no shop currently lists this bottle on Whiskybase.';
}

// ---------------------------------------------------------------------------
// Lookup per tab

const brief = (r) =>
  r && { id: r.id, url: r.url, text: r.text, score: r.score, reasons: r.reasons, rating: r.rating, photo: r.photo };

async function setLookup(tabId, lookup) {
  await chrome.storage.session.set({ [`lookup:${tabId}`]: lookup });
}

/**
 * Searches Whiskybase for the detected bottle and stores the outcome: state is
 * 'searching', 'match', 'nomatch', 'blocked', 'waiting' (for a search tab the
 * user opened after a failed search), 'noaccess' or 'error'. `searched` is a search
 * outcome already in hand (read from such a tab).
 */
async function lookup(tabId, pageUrl, whisky, searched) {
  const query = Whiskybase.buildQuery(whisky);
  const base = { pageUrl, query, searchUrl: Whiskybase.searchUrl(query) };
  if (!query) return setLookup(tabId, { ...base, state: 'error', error: 'Nothing to search for' });
  if (!(await chrome.permissions.contains({ origins: Whiskybase.HOSTS }))) {
    return setLookup(tabId, { ...base, state: 'noaccess' });
  }

  if (!searched) await setLookup(tabId, { ...base, state: 'searching' });
  const r = searched || (await search(query));
  if (pageUrls.get(tabId) !== pageUrl) return; // navigated away meanwhile

  if (r.state !== 'ok') {
    return setLookup(tabId, { ...base, state: r.state, error: r.error, status: r.status });
  }
  const { match, ranked } = Whiskybase.matchResults(whisky, r.results);
  const result = {
    ...base,
    state: match ? 'match' : 'nomatch',
    total: r.total,
    cached: !!r.cached,
    match: brief(match),
    candidates: ranked.slice(0, 5).map(brief),
  };
  await setLookup(tabId, result);
  if (match) setBadge(tabId, 'match', `${Whiskybase.displayId(match.id)} ${match.text}`);
}

/**
 * The number of ratings, the bottling series, the shop price and the photo,
 * which are only on the bottle's own page. They are fetched when the popup
 * shows the match rather than for every page with one, to keep the requests
 * to Whiskybase (and with them Cloudflare's checks) down.
 */
const detailing = new Set();
async function addDetails(tabId) {
  const key = `lookup:${tabId}`;
  const lk = (await chrome.storage.session.get(key))[key];
  if (!lk || lk.state !== 'match' || lk.match.detailed || detailing.has(tabId)) return;
  detailing.add(tabId);
  try {
    const details = await bottleDetails(lk.match);
    const photo = await photoData([lk.match.photo, details.photo].filter(Whiskybase.isBottlePhoto));
    const now = (await chrome.storage.session.get(key))[key];
    if (!now || now.state !== 'match' || now.pageUrl !== lk.pageUrl || now.match.id !== lk.match.id) return;
    await setLookup(tabId, {
      ...now,
      match: {
        ...now.match,
        detailed: true,
        rating: details.rating || now.match.rating,
        reviews: details.reviews != null ? details.reviews : null,
        price: details.price || null,
        shops: details.shops || null,
        series: details.series || null,
        detailsNote: details.note,
        photo: photo.url || null,
        photoData: photo.data || null,
        photoNote: photo.note || null,
      },
    });
  } finally {
    detailing.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// After a failed search (a Cloudflare check, say): the popup asks to open the
// search in a tab, where the user passes the check if one shows up. Once that tab has loaded the
// results, they are read from it and matched for the original tab. The tabs
// are kept as searchTab:<search tab id> in chrome.storage.session, since the
// worker may be stopped while the user is busy with the check.

async function openSearch(tabId, pageUrl, whisky) {
  const query = Whiskybase.buildQuery(whisky);
  const searchUrl = Whiskybase.searchUrl(query);
  // A new tab even when there is a helper tab: the user may be using that one.
  const tab = await chrome.tabs.create({ url: searchUrl, openerTabId: tabId });
  // The failed lookup, to go back to if the tab doesn't bring results.
  const before = (await chrome.storage.session.get(`lookup:${tabId}`))[`lookup:${tabId}`] || null;
  await chrome.storage.session.set({ [`searchTab:${tab.id}`]: { tabId, pageUrl, whisky, query, before } });
  await setLookup(tabId, { pageUrl, query, searchUrl, state: 'waiting', searchTabId: tab.id });
}

/**
 * The search results in a Whiskybase tab. The page is fetched again from
 * inside the tab, as the page itself would, because the rendered page no
 * longer has the full results data the server sent; the rendered page is the
 * fallback. Null if the tab cannot be read.
 */
async function readSearchTab(searchTabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: searchTabId },
      func: async () => {
        const dom = document.documentElement.outerHTML;
        try {
          const res = await fetch(location.href, { credentials: 'include' });
          return { served: await res.text(), dom };
        } catch (e) {
          return { served: '', dom };
        }
      },
    });
    const served = Whiskybase.analyseSearchHtml(result.served);
    return result.served && !served.challenge ? served : Whiskybase.analyseSearchHtml(result.dom);
  } catch (e) {
    return null;
  }
}

// Back to the failed lookup when the search tab is closed or leaves the search.
async function dropSearchTab(searchTabId, pending) {
  await chrome.storage.session.remove(`searchTab:${searchTabId}`);
  const key = `lookup:${pending.tabId}`;
  const lk = (await chrome.storage.session.get(key))[key];
  if (lk && lk.state === 'waiting' && lk.searchTabId === searchTabId) {
    const before = pending.before && pending.before.pageUrl === lk.pageUrl ? pending.before : null;
    await setLookup(pending.tabId, before || { pageUrl: lk.pageUrl, query: lk.query, searchUrl: lk.searchUrl, state: 'blocked' });
  }
}

chrome.tabs.onUpdated.addListener(async (searchTabId, info, tab) => {
  // Leaving Whiskybase in the helper tab ends its job. (Chrome only shows the
  // extension URLs on sites it has access to, so another site shows as none.)
  if ((info.url || info.status === 'loading') && !(tab.url || '').startsWith(WHISKYBASE_PAGES)) {
    const { helperTab: h } = await chrome.storage.session.get('helperTab');
    if (h && h.tabId === searchTabId) await chrome.storage.session.remove('helperTab');
  }
  if (info.status !== 'complete') return;
  const key = `searchTab:${searchTabId}`;
  const pending = (await chrome.storage.session.get(key))[key];
  if (!pending) return;
  const q = (tab.url || '').startsWith(Whiskybase.SEARCH_URL) && new URL(tab.url).searchParams.get('q');
  if (q !== pending.query) return dropSearchTab(searchTabId, pending);

  const page = await readSearchTab(searchTabId);
  if (!page || page.challenge) return; // still on the check: the tab loads again once it is passed
  await chrome.storage.session.remove(key);
  await chrome.storage.session.set({ helperTab: { tabId: searchTabId } });
  const value = { state: 'ok', url: tab.url, status: 200, page };
  await chrome.storage.session.set({ [`search:${pending.query}`]: { at: Date.now(), value } });

  const lk = (await chrome.storage.session.get(`lookup:${pending.tabId}`))[`lookup:${pending.tabId}`];
  if (!lk || lk.pageUrl !== pending.pageUrl) return; // the original tab moved on meanwhile
  pageUrls.set(pending.tabId, pending.pageUrl);
  lookup(pending.tabId, pending.pageUrl, pending.whisky, { ...value, total: page.total, results: page.whiskies });
});

// ---------------------------------------------------------------------------
// Helper tab: the search tab the user got through the check in. While it stays
// open on www.whiskybase.com (on any page), requests that Cloudflare stops, or
// that fall in the pause after a check, are done from inside it, as the
// Whiskybase page itself would. Nothing in the tab changes. Once requests from
// the background go through again, it isn't used, and once it is closed or
// leaves Whiskybase, it is let go. No other Whiskybase tab is ever used.
// Kept as helperTab: { tabId } in chrome.storage.session.

const WHISKYBASE_PAGES = 'https://www.whiskybase.com/';

/** The helper tab, while it is still open on Whiskybase; null otherwise. */
async function helperTab() {
  const { helperTab: h } = await chrome.storage.session.get('helperTab');
  if (!h) return null;
  try {
    const tab = await chrome.tabs.get(h.tabId);
    if ((tab.url || '').startsWith(WHISKYBASE_PAGES)) return tab;
  } catch (e) {
    // Closed.
  }
  await chrome.storage.session.remove('helperTab');
  return null;
}

/** Like fetchPage, from inside the helper tab; null without one. */
async function fetchInHelperTab(url, analyse) {
  const tab = await helperTab();
  if (!tab) return null;
  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (u) => {
        try {
          const res = await fetch(u, { credentials: 'include' });
          return { status: res.status, ok: res.ok, mitigated: !!res.headers.get('cf-mitigated'), html: await res.text() };
        } catch (e) {
          return { error: String(e) };
        }
      },
      args: [url],
    });
  } catch (e) {
    return null; // e.g. the tab is loading another page
  }
  if (!result || result.error) return null;
  const page = analyse(result.html);
  if (page.challenge || result.mitigated) return { state: 'blocked', url, status: result.status };
  if (!result.ok) return { state: 'error', url, status: result.status, error: `HTTP ${result.status}` };
  return { state: 'ok', url, status: result.status, page };
}

// ---------------------------------------------------------------------------
// Messages

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  // "Try again" in the popup: the user asks to search once more, so the pause
  // after a Cloudflare check no longer applies.
  if (msg.type === 'whisky:retry' && (sender.url || '').startsWith(chrome.runtime.getURL('popup/'))) {
    chrome.storage.session.remove('blockedAt').then(() => {
      pageUrls.set(msg.tabId, msg.url);
      lookup(msg.tabId, msg.url, msg.whisky);
    });
    return;
  }

  const fromPopup = (sender.url || '').startsWith(chrome.runtime.getURL('popup/'));
  if (msg.type === 'whisky:open-search' && fromPopup) return void openSearch(msg.tabId, msg.url, msg.whisky);
  if (msg.type === 'whisky:details' && fromPopup) return void addDetails(msg.tabId);

  if (msg.type !== 'whisky:detection' || !sender.tab || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  const { status, whisky, confidence, url } = msg.result;
  setBadge(tabId, status, whisky.name);

  const previousUrl = pageUrls.get(tabId);
  pageUrls.set(tabId, url);
  if (status === 'whisky' && confidence >= AUTO_MIN_CONFIDENCE) {
    lookup(tabId, url, whisky);
  } else if (previousUrl !== url) {
    chrome.storage.session.remove(`lookup:${tabId}`);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  pageUrls.delete(tabId);
  chrome.storage.session.remove(`lookup:${tabId}`);
  const pending = (await chrome.storage.session.get(`searchTab:${tabId}`))[`searchTab:${tabId}`];
  if (pending) dropSearchTab(tabId, pending);
  const { helperTab: h } = await chrome.storage.session.get('helperTab');
  if (h && h.tabId === tabId) chrome.storage.session.remove('helperTab');
});

// ---------------------------------------------------------------------------
// Automatic checking: without it, the popup loads the detector when the toolbar
// icon is clicked (activeTab). Turning it on in the popup grants the optional
// access to all sites and sets autoCheck in chrome.storage.local; the content
// script is registered while both hold.
//
// Turning it off only clears autoCheck. Withdrawing the access to all sites
// (permissions.remove) would also take the Whiskybase hosts with it, and Chrome
// gives those back only on a new click and prompt.

const ALL_SITES = ['http://*/*', 'https://*/*'];
const AUTO_SCRIPT = { id: 'detector', matches: ALL_SITES, js: ['src/detector.js', 'src/content.js'], runAt: 'document_idle' };

async function syncAutoCheck() {
  const { autoCheck } = await chrome.storage.local.get('autoCheck');
  const on = !!autoCheck && (await chrome.permissions.contains({ origins: ALL_SITES }));
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT.id] })).length > 0;
  try {
    if (on && !registered) await chrome.scripting.registerContentScripts([AUTO_SCRIPT]);
    if (!on && registered) await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT.id] });
  } catch (e) {
    console.warn('Automatic checking:', e); // e.g. two changes at once; the next one syncs again
  }
}

chrome.runtime.onInstalled.addListener(syncAutoCheck);
chrome.runtime.onStartup.addListener(syncAutoCheck);
chrome.permissions.onRemoved.addListener(syncAutoCheck);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoCheck) syncAutoCheck();
});
// Chrome may close the popup for its permission prompt before the popup can
// store the setting, so accepting the prompt turns it on here too.
chrome.permissions.onAdded.addListener(async () => {
  if (await chrome.permissions.contains({ origins: ALL_SITES })) await chrome.storage.local.set({ autoCheck: true });
  syncAutoCheck();
});
