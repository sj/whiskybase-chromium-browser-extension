/*
 * Background service worker:
 *  - shows the detection result as a per-tab badge on the toolbar icon
 *    (Chrome resets tab-specific badges on navigation);
 *  - for confident detections, looks the bottle up on Whiskybase and stores
 *    the outcome per tab in chrome.storage.session, where the popup reads it.
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
const MIN_GAP_MS = 2000; // at least this long between requests to Whiskybase
const BLOCKED_PAUSE_MS = 2 * 60 * 1000; // no automatic searches this long after a Cloudflare check

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

/** Fetches a Whiskybase page and runs `analyse` on its HTML; 'blocked' on a Cloudflare check. */
async function fetchPage(url, analyse) {
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

/** Cached, throttled, one-at-a-time fetch; `analyse` must return plain data. */
async function cachedFetch(key, url, analyse) {
  const cached = (await chrome.storage.session.get(key))[key];
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.value, cached: true };

  const run = queue.then(() => fetchPage(url, analyse));
  queue = run.catch(() => {});
  const value = await run;
  if (value.state === 'ok') await chrome.storage.session.set({ [key]: { at: Date.now(), value } });
  if (value.state === 'blocked') await chrome.storage.session.set({ blockedAt: Date.now() });
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
 * Searches Whiskybase for the detected bottle and stores the outcome:
 * state is 'searching', 'match', 'nomatch', 'blocked' or 'error'.
 */
async function lookup(tabId, pageUrl, whisky) {
  const query = Whiskybase.buildQuery(whisky);
  const base = { pageUrl, query, searchUrl: Whiskybase.searchUrl(query) };
  if (!query) return setLookup(tabId, { ...base, state: 'error', error: 'Nothing to search for' });

  const { blockedAt } = await chrome.storage.session.get('blockedAt');
  if (blockedAt && Date.now() - blockedAt < BLOCKED_PAUSE_MS) {
    return setLookup(tabId, { ...base, state: 'blocked', paused: true });
  }

  await setLookup(tabId, { ...base, state: 'searching' });
  const r = await search(query);
  if (pageUrls.get(tabId) !== pageUrl) return; // navigated away meanwhile

  if (r.state !== 'ok') return setLookup(tabId, { ...base, state: r.state, error: r.error, status: r.status });
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
  if (!match) return;
  setBadge(tabId, 'match', `${Whiskybase.displayId(match.id)} ${match.text}`);

  // The number of ratings and the shop price are only on the bottle's own page.
  const details = await bottleDetails(match);
  const photo = await photoData([result.match.photo, details.photo].filter(Whiskybase.isBottlePhoto));
  if (pageUrls.get(tabId) !== pageUrl) return;
  await setLookup(tabId, {
    ...result,
    match: {
      ...result.match,
      rating: details.rating || result.match.rating,
      reviews: details.reviews != null ? details.reviews : null,
      price: details.price || null,
      shops: details.shops || null,
      detailsNote: details.note,
      photo: photo.url || null,
      photoData: photo.data || null,
      photoNote: photo.note || null,
    },
  });
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

chrome.tabs.onRemoved.addListener((tabId) => {
  pageUrls.delete(tabId);
  chrome.storage.session.remove(`lookup:${tabId}`);
});
