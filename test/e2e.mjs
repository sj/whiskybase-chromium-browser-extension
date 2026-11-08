// Browser test: the extension itself in headless Chromium, on fixture pages.
//
// Usage: npm run e2e                  (set CHROME_BIN to pick a browser)
//
// Loads a copy of the extension (in test/.out/e2e, with access to all sites so
// that automatic checking needs no prompt) into a fresh profile, and drives it
// over the DevTools protocol. Pages are fixtures served at their real
// addresses, Whiskybase answers with its fixtures, and every other request is
// blocked, so nothing goes out. Without the shops' stylesheets and images the
// pages aren't laid out as on the web: what depends on layout (where a badge
// goes on a photo) can't be checked here.
//
// Google Chrome 137 and later ignore --load-extension; use Chromium or Chrome
// for Testing.

import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, '.out', 'e2e');
const fixture = (f) => readFileSync(join(here, 'fixtures', f));
const PORT = 9399;

// Opened at its own address; the list links to it with a parameter that its
// canonical address leaves out (?sku=127692).
const LOT = 'https://www.whiskyauction.com/item/4838071';
const PRODUCT = 'https://www.masterofmalt.com/whiskies/inchgower/inchgower-fruity-and-sweet-madeira-finish-cask-craft-murray-mcdavid-whisky/';
const PAGES = {
  [PRODUCT]: fixture('masterofmalt.com-inchgower-murray-mcdavid-product-page.html'),
  'https://www.masterofmalt.com/distilleries/inchgower-whisky-distillery/': fixture('masterofmalt.com-bottle-list.html'),
  'https://smws.com/tempest-in-the-tropics-3-369/': fixture('smws-3-369.html'),
  [LOT]: fixture('whiskyauction.com-4838071-product-page-WB36642.html'),
  'https://www.whiskyauction.com/wac/auctionBrowser': fixture('whiskyauction.com-auction-browser.html'),
};
// Whiskybase's search results, by the start of the query.
const WB_SEARCHES = {
  'Inchgower ': fixture('whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-search-results.html'),
  'Port Ellen ': fixture('whiskybase/whiskyauction.com-4838071-whiskybase-search-results.html'),
};
const WB_BOTTLE = fixture('whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-bottle-page.html');
// Photos (the lot's are laid out only with a size): any image will do.
const PHOTO = readFileSync(join(root, 'icons', 'icon128.png'));

function findBrowser() {
  for (const bin of [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].filter(Boolean)) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch (e) {
      // try the next one
    }
  }
  throw new Error('No Chromium/Chrome found; set CHROME_BIN');
}

// A fresh copy and profile on every run: in a profile it has run in before,
// Chromium keeps the service worker's old code until the version changes.
rmSync(out, { recursive: true, force: true });
const ext = join(out, 'ext');
mkdirSync(ext, { recursive: true });
for (const f of ['manifest.json', 'src', 'popup', 'icons']) cpSync(join(root, f), join(ext, f), { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://*/*', 'https://*/*');
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

const ciFlags = process.env.CI ? ['--no-sandbox'] : [];
const browser = spawn(findBrowser(), ['--headless', ...ciFlags, `--user-data-dir=${join(out, 'profile')}`, `--remote-debugging-port=${PORT}`,
  `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => browser.kill());

// --- DevTools protocol ---------------------------------------------------------

let version;
for (let i = 0; i < 50 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch (e) {
    await sleep(200);
  }
}
if (!version) throw new Error('The browser did not start');
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let lastId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else events.forEach((h) => h(d));
};
const send = (method, params = {}, sessionId) =>
  new Promise((r) => {
    const id = ++lastId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
// Evaluates `expr` (awaiting a promise) in a page or the service worker.
async function evaluate(expr, session) {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, session)).result;
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, session, ms = 10000) {
  let value;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    value = await evaluate(expr, session).catch(() => null);
    if (value) return value;
  }
  return value;
}

// Fixtures for the pages and Whiskybase; nothing else is fetched.
events.push(async (d) => {
  if (d.method !== 'Fetch.requestPaused') return;
  const { url } = d.params.request;
  const query = url.startsWith('https://www.whiskybase.com/search?') && new URL(url).searchParams.get('q');
  const search = query && Object.entries(WB_SEARCHES).find(([start]) => query.startsWith(start));
  const isPhoto = d.params.resourceType === 'Image' && url.startsWith('https://cdn.whiskyauction.com/');
  const body = PAGES[url] && d.params.resourceType === 'Document' ? PAGES[url]
    : query ? search && search[1]
    : url.startsWith('https://www.whiskybase.com/whiskies/') ? WB_BOTTLE
    : isPhoto ? PHOTO : null;
  if (!body) return send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'BlockedByClient' }, d.sessionId);
  await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
    responseHeaders: [{ name: 'content-type', value: isPhoto ? 'image/png' : 'text/html; charset=utf-8' }], body: body.toString('base64') }, d.sessionId);
});
const ALL = [{ urlPattern: '*' }];
await send('Fetch.enable', { patterns: ALL }); // browser-wide: the extension's search and helper tabs too

let worker;
for (let i = 0; i < 40 && !worker; i++) {
  const { targetInfos } = (await send('Target.getTargets')).result;
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
  if (sw) worker = (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).result.sessionId;
  else await sleep(250);
}
if (!worker) throw new Error('The extension did not load (Google Chrome 137 and later ignore --load-extension)');
await send('Fetch.enable', { patterns: ALL }, worker); // the service worker's own requests

async function openPage(url) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const session = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await send('Fetch.enable', { patterns: ALL }, session);
  await send('Page.navigate', { url }, session);
  const tabId = await waitFor(`chrome.tabs.query({}).then((t) => (t.find((x) => x.url === ${JSON.stringify(url)}) || {}).id)`, worker);
  return { session, tabId };
}
// The detection in the tab, from its content script.
const detection = (tabId) => evaluate(`chrome.tabs.sendMessage(${tabId}, { type: 'whisky:get' })`, worker);

// --- Checks --------------------------------------------------------------------

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}\n        ${String(e.message).split('\n').join('\n        ')}`);
  }
}
function expect(actual, wanted, what) {
  if (actual !== wanted) throw new Error(`${what}: ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
}

console.log('\nExtension in the browser');
await evaluate(`chrome.storage.local.set({ autoCheck: true })`, worker);
await waitFor(`chrome.scripting.getRegisteredContentScripts().then((s) => s.length)`, worker);

const product = await openPage(PRODUCT);
await check('product page: detected and matched to Whiskybase', async () => {
  const lookup = await waitFor(`chrome.storage.session.get('lookup:${product.tabId}').then((r) => { const l = r['lookup:${product.tabId}']; return l && l.state !== 'searching' && l; })`, worker, 20000);
  expect((await detection(product.tabId)).status, 'whisky', 'detection');
  expect(lookup && lookup.state, 'match', 'lookup');
  expect(lookup.match.id, '233907', 'match');
});
await check('product page: match stored under the page address and as its canonical one', async () => {
  const key = await evaluate(`KnownPages.key(${JSON.stringify(PRODUCT)})`, worker);
  const stored = await evaluate(`chrome.storage.local.get(${JSON.stringify([`known:${key}`, `known:${key}#canonical`])})`, worker);
  expect(stored[`known:${key}`] && stored[`known:${key}`].id, '233907', 'stored match');
  expect(stored[`known:${key}#canonical`] && stored[`known:${key}#canonical`].id, '233907', 'stored as canonical');
});
await check('product page: faint icon after the title, with the matched tooltip', async () => {
  const tip = await waitFor(`(() => { const h = document.querySelector('[data-bottle-lookup-title]'); const t = h && h.shadowRoot.querySelector('title').textContent; return t && t.includes('matched') && t; })()`, product.session);
  expect(tip, 'Bottle information detected and matched to Whiskybase. Click to see more in browser extension.', 'tooltip');
});

const list = await openPage('https://www.masterofmalt.com/distilleries/inchgower-whisky-distillery/');
await check('list page: a listing, not a bottle; no title icon', async () => {
  await waitFor(`document.readyState === 'complete'`, list.session);
  const d = await waitFor(`chrome.tabs.sendMessage(${list.tabId}, { type: 'whisky:get' }).then((r) => r && r.status)`, worker);
  expect(d, 'none', 'detection');
  expect(await evaluate(`!!document.querySelector('[data-bottle-lookup-title]')`, list.session), false, 'title icon');
});
await check('list page: the bottle matched before gets its badge', async () => {
  const badges = await waitFor(`(() => { const b = [...document.querySelectorAll('[data-bottle-lookup]')].map((h) => h.closest('a').getAttribute('href')); return b.length && b; })()`, list.session);
  if (!badges || !badges.every((href) => href.includes('inchgower-fruity-and-sweet-madeira-finish-cask-craft-murray-mcdavid'))) {
    throw new Error(`badges on ${JSON.stringify(badges)}`);
  }
});

const smws = await openPage('https://smws.com/tempest-in-the-tropics-3-369/');
await check('smws.com: distillery name after the bottle code', async () => {
  const note = await waitFor(`(() => { const h = document.querySelector('[data-bottle-lookup-smws]'); return h && h.getAttribute('data-bottle-lookup-smws') + h.shadowRoot.textContent; })()`, smws.session);
  expect(note, '3.369 (Bowmore)', 'note');
});
await check('smws.com: the note is not part of the page text the detector reads', async () => {
  const d = await detection(smws.tabId);
  expect(d.status, 'whisky', 'detection');
  if (/Bowmore/.test(d.whisky.name)) throw new Error(`name: ${d.whisky.name}`);
});

const lot = await openPage(LOT);
await check('whiskyauction.com lot: matched, and its photo gets the badge', async () => {
  const lookup = await waitFor(`chrome.storage.session.get('lookup:${lot.tabId}').then((r) => { const l = r['lookup:${lot.tabId}']; return l && l.state !== 'searching' && l; })`, worker, 20000);
  expect(lookup && lookup.state, 'match', 'lookup');
  expect(lookup.match.id, '36642', 'match');
  const badge = await waitFor(`(() => { const h = document.querySelector('[data-bottle-lookup-page]'); return h && h.parentElement.querySelector('img').className + ' ' + h.shadowRoot.querySelector('b').textContent; })()`, lot.session);
  expect(badge, 'detailpage-image 93.75', 'photo badge');
});

// Its list loads the cards by script; one card as the site renders it.
const CARD = '<div class="cardcontent"><a class="card-link" href="/item/4838071" target="_BLANK"><div class="cardcontent-top">' +
  '<div class="cardcontent-title cardcontent-title-auction"> #4838071 </div><div class="cardcontent-image">' +
  '<img src="https://cdn.whiskyauction.com/auction/i/im2611card/483807101.jpg" class="rounded" loading="lazy"></div>' +
  '<div class="cardcontent-description-text">Gordon &amp; MacPhail<br>62.4% Vol, 750 ml</div></div></a></div>';
const auction = await openPage('https://www.whiskyauction.com/wac/auctionBrowser');
await check('whiskyauction.com list: the card of the lot matched before gets its badge', async () => {
  await waitFor(`document.readyState === 'complete'`, auction.session);
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(CARD)}), 1`, auction.session);
  const badges = await waitFor(`(() => { const b = [...document.querySelectorAll('[data-bottle-lookup]')].map((h) => h.closest('a').getAttribute('href') + ' ' + h.shadowRoot.querySelector('b').textContent); return b.length && b; })()`, auction.session);
  expect(JSON.stringify(badges), JSON.stringify(['/item/4838071 93.75']), 'badges');
});

console.log(failures ? `\n${failures} failed` : '\nAll browser tests passed');
process.exit(failures ? 1 : 0);
