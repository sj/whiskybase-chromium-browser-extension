'use strict';

const $ = (id) => document.getElementById(id);

const README_URL = 'https://github.com/sj/whiskybase-chromium-browser-extension';

const STATUS_TEXT = {
  whisky: 'Whisky bottle detected',
  possible: 'Possibly a whisky bottle',
  none: 'No whisky bottle detected on this page',
};

const FIELDS = [
  ['Name', (w) => w.name],
  ['Brand', (w) => w.brand],
  ['Distillery', (w) => w.distillery],
  ['Bottler', bottlerCell],
  ['Age', (w) => w.age && `${w.age} years`],
  ['ABV', (w) => w.abv && `${w.abv}%`],
  ['Volume', (w) => w.volumeMl && (w.volumeMl % 10 ? `${w.volumeMl} ml` : `${w.volumeMl / 10} cl`)],
  ['Vintage', (w) => w.vintage],
  ['Bottled', (w) => w.bottled],
  ['Cask no.', (w) => w.caskNumber],
  ['EAN/GTIN', (w) => w.gtin],
];

// Only an independent bottler gets a row; distillery bottlings and unknown bottlers don't.
function bottlerCell(w) {
  return w.bottling === 'independent' ? w.bottler || '' : '';
}

// One line: "**Whisky bottle detected**. Confidence: 85%".
function showStatus(cls, title, detail) {
  const el = $('status');
  el.hidden = false;
  el.className = `status status-${cls}`;
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  el.append(strong, '.');
  if (detail) el.append(' ', detail);
}

function render(result) {
  const { status, whisky, reasons } = result;
  showStatus(status, STATUS_TEXT[status], `Confidence: ${Math.round(result.confidence * 100)}%`);
  $('parsed-title').textContent = status === 'none' ? 'No whisky information detected' : 'Whisky information detected';
  // A detected bottle speaks for itself; otherwise the box asks for feedback (and, when
  // nothing was found, the heading already says so).
  $('status').hidden = status === 'whisky';
  const here = link(`${README_URL}#did-your-bottle-not-get-detected-on-a-page`, 'here');
  if (status === 'none') {
    $('status').replaceChildren(
      'This page does not seem to contain any information pertaining to a bottle of whisky. Do you think that’s incorrect? Let us know ',
      here,
      '.'
    );
  } else if (status === 'possible') {
    $('status').append('. Did the extension get this wrong? Let us know ', here, '.');
  }

  const table = $('fields');
  table.replaceChildren();
  if (status !== 'none') {
    for (const [label, get] of FIELDS) {
      const value = get(whisky);
      if (!value) continue;
      const tr = table.insertRow();
      const th = document.createElement('th');
      th.textContent = label;
      tr.append(th);
      tr.insertCell().textContent = value;
    }
  }
  table.hidden = table.rows.length === 0;

  const list = $('reasons');
  list.replaceChildren();
  for (const r of reasons) {
    const li = document.createElement('li');
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = (r.points > 0 ? '+' : '') + r.points;
    li.append(pts, r.text);
    list.append(li);
  }
  $('no-reasons').hidden = reasons.length > 0;
  $('accept').textContent = `${result.status === 'whisky' ? 'Accepted' : 'Not accepted'}: scored ${result.score} points.`;
  $('accept').hidden = !reasons.length;
  $('why').hidden = false;

  renderWhiskybase();
}

// --- Whiskybase lookup ------------------------------------------------------
// The background worker searches automatically for confident detections and
// stores the outcome as lookup:<tabId> in chrome.storage.session.

let currentTabId = null;
let currentResult = null;
let currentLookup = null;
let currentQuery = '';

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function link(href, text) {
  return el('a', { href, target: '_blank', rel: 'noopener' }, text);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// A 14px outline icon from SVG path data, in the text colour.
function icon(...paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    for (const [k, v] of Object.entries({ d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
    svg.append(path);
  }
  return svg;
}

const COPY_ICON = ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'];
const COPIED_ICON = ['M3.5 8.5l3 3 6-7'];

// A small icon button that copies `text`, showing a tick for a moment after.
function copyButton(text) {
  const label = `Copy ${text}`;
  const button = el('button', { type: 'button', className: 'copy', title: label, ariaLabel: label }, icon(...COPY_ICON));
  let timer;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    button.replaceChildren(icon(...COPIED_ICON));
    button.title = button.ariaLabel = 'Copied';
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.replaceChildren(icon(...COPY_ICON));
      button.title = button.ariaLabel = label;
    }, 1500);
  });
  return button;
}

function candidateList(candidates) {
  const list = el('ol', { className: 'wb-list' });
  for (const r of candidates) {
    const why = (r.reasons || []).map((x) => `${x.points > 0 ? '+' : ''}${x.points} ${x.text}`).join('\n');
    list.append(
      el('li', { title: why }, link(r.url, Whiskybase.displayId(r.id)), ` ${r.text} `, el('span', { className: 'muted' }, `(${r.score})`))
    );
  }
  return list;
}

const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

function reasonList(reasons) {
  const list = el('ul', { className: 'reasons' });
  for (const x of reasons || []) list.append(el('li', {}, el('span', { className: 'pts' }, signed(x.points)), x.text));
  return list;
}

/**
 * "Details of Whiskybase match" (only for a confident match): what was
 * searched for, how the match scored, and the other candidates.
 */
function matchDetails(lk) {
  const [best] = lk.candidates;
  const body = el('div', {});
  body.append(
    el(
      'p',
      {},
      `Searched for “${lk.query}” (`,
      link(lk.searchUrl, `${lk.total} ${lk.total === 1 ? 'result' : 'results'}`),
      `${lk.cached ? ', cached' : ''}). Match `,
      link(best.url, Whiskybase.displayId(best.id)),
      ':'
    ),
    reasonList(best.reasons),
    el('p', {}, `Accepted: scored ${best.score} points.`)
  );
  if (lk.match.detailsNote) body.append(el('p', {}, lk.match.detailsNote));
  if (lk.match.photoNote) body.append(el('p', {}, lk.match.photoNote));
  if (lk.candidates.length > 1) {
    body.append(el('p', {}, 'Other candidates (hover for points):'), candidateList(lk.candidates.slice(1)));
  }
  return el('details', { className: 'wb-details muted' }, el('summary', {}, 'Details of Whiskybase match'), body);
}

function ratingText(m) {
  if (!m.rating) return 'Not rated yet';
  const n = m.reviews != null ? ` (${m.reviews} ${m.reviews === 1 ? 'review' : 'reviews'})` : '';
  return `${m.rating.toFixed(2)} / 100${n}`;
}

const priceText = (m) => `${m.price} (${m.shops} ${m.shops === 1 ? 'shop' : 'shops'})`;

// Photo on top, then the name (and series) and a table like the parsed data: ID, rating, price.
function matchCard(m) {
  const card = el('div', { className: 'wb-match' });
  if (m.photoData || m.photo) {
    const img = el('img', { src: m.photoData || m.photo, alt: m.text, className: 'wb-photo' });
    const a = link(m.url, img);
    a.className = 'wb-photo-link';
    img.addEventListener('error', () => a.remove());
    card.append(a);
  }
  const rows = [
    ['Whiskybase ID', [link(m.url, Whiskybase.displayId(m.id)), copyButton(Whiskybase.displayId(m.id))], 'wb-id'],
    ['Rating', ratingText(m), 'wb-rating'],
  ];
  // Only for bottles that shops currently list.
  if (m.price && m.shops) rows.push(['Price estimate', priceText(m), 'wb-price']);
  const table = el('table', { className: 'wb-fields' });
  for (const [label, value, className] of rows) table.append(el('tr', { className }, el('th', {}, label), el('td', {}, ...[value].flat())));
  // The name in bold, then the bottling series (when Whiskybase has one) in brackets.
  const name = el('p', { className: 'wb-name' }, m.text);
  if (m.series) name.append(' ', el('span', { className: 'wb-series' }, `(${m.series})`));
  card.append(name, table);
  return card;
}

function renderWhiskybase() {
  const r = currentResult;
  $('wb').hidden = !r || r.status === 'none';
  document.body.classList.toggle('wide', !$('wb').hidden);
  if ($('wb').hidden) return;

  const lk = currentLookup && currentLookup.pageUrl === r.url ? currentLookup : null;
  currentQuery = (lk && lk.query) || Whiskybase.buildQuery(r.whisky);
  $('wb-run').title = `Search Whiskybase for “${currentQuery}”`;
  // With a match, the button sits in the heading, mirroring Re-scan on the left; otherwise below.
  const inHead = !!lk && lk.state === 'match';
  if (inHead) $('wb-head').append($('wb-run'));
  else $('wb-body').append($('wb-run'));
  $('wb-run').classList.toggle('wb-manual', !inHead);

  const out = $('wb-result');
  out.replaceChildren();
  $('wb-foot').replaceChildren();
  // Not searched automatically, "Find on Whiskybase" takes its place until it has been tried;
  // after a failed search, "Search on Whiskybase" does.
  const auto = r.status === 'whisky' && r.confidence >= 0.9;
  $('wb-run').hidden = lk
    ? lk.state === 'blocked' || lk.state === 'waiting' || (lk.state === 'error' && !!lk.query)
    : !auto;
  // The check message takes the column's heading, so it lines up with the one on the left.
  $('wb-title').textContent = lk && lk.state === 'blocked' ? 'Whiskybase wants a quick check first' : 'Whiskybase match';

  if (!lk && auto) {
    out.append(el('p', { className: 'muted' }, 'Searching Whiskybase…'));
  } else if (!lk) {
    out.append(
      el('p', { className: 'muted' }, 'Not looked up automatically, as the extension isn’t sure about this bottle (confidence below 90%).'),
      findButton()
    );
  } else if (lk.state === 'searching') {
    out.append(el('p', { className: 'muted' }, 'Searching Whiskybase…'));
  } else if (lk.state === 'match') {
    out.append(matchCard(lk.match));
    // Below both columns' content, level with Details of parsed data.
    $('wb-foot').append(matchDetails(lk));
    // The bottle page (reviews, series, price, photo) is fetched now that the match is shown.
    if (!lk.match.detailed) {
      out.append(el('p', { className: 'muted' }, 'Loading details from Whiskybase…'));
      chrome.runtime.sendMessage({ type: 'whisky:details', tabId: currentTabId });
    }
  } else if (lk.state === 'nomatch') {
    out.append(el('p', { className: 'wb-bad' }, lk.total ? 'No confident match. Best candidates:' : 'No results.'));
    if (lk.candidates.length) out.append(candidateList(lk.candidates));
    // With several candidates, the question is less whether the bottle is on Whiskybase than which one it is.
    const report = (text) => link(`${README_URL}#did-your-bottle-not-get-detected-on-a-page`, text);
    out.append(
      lk.candidates.length > 1
        ? el('p', { className: 'muted' }, 'If you think the detection or matching can be improved, ', report('let us know'), '.')
        : el('p', { className: 'muted' }, 'Is this bottle on Whiskybase after all? Let us know ', report('here'), '.')
    );
  } else if (lk.state === 'noaccess') {
    out.append(
      el('p', { className: 'wb-bad' }, 'No access to Whiskybase.'),
      el('p', {}, 'The extension needs access to www.whiskybase.com and static.whiskybase.com to look bottles up.'),
      accessButton()
    );
  } else if (lk.state === 'blocked') {
    out.append(
      el(
        'p',
        {},
        'Every now and then, a search on Whiskybase fails, for instance due to rate limiting or other checks. ' +
          'Open the search on Whiskybase and pass the check there if one shows up: the result then appears here as well.'
      ),
      openSearchButton(),
      retryButton('wb-retry wb-secondary')
    );
  } else if (lk.state === 'waiting') {
    out.append(
      el('p', { className: 'muted' }, 'Waiting for the Whiskybase tab…'),
      el('p', {}, 'Pass the check there if one shows up. The result appears here once the search results have loaded.'),
      switchTabButton(lk.searchTabId)
    );
  } else {
    out.append(el('p', { className: 'wb-bad' }, `Search failed: ${lk.error || 'unknown error'}`));
    // Whatever went wrong, the search may still work in a tab of its own.
    if (lk.query) out.append(openSearchButton(), retryButton('wb-retry wb-secondary'));
    else out.append(retryButton());
  }
}

// Asks the background to look this page's bottle up, as it does by itself for confident detections.
function findButton() {
  const button = el('button', { type: 'button', className: 'wb-retry wb-primary' }, 'Find this bottle on Whiskybase');
  button.addEventListener('click', () => {
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'whisky:lookup', tabId: currentTabId, url: currentResult.url, whisky: currentResult.whisky });
  });
  return button;
}

// Asks the background to search Whiskybase again for this page.
function retryButton(className = 'wb-retry') {
  const button = el('button', { type: 'button', className }, 'Try again');
  button.addEventListener('click', () => {
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'whisky:retry', tabId: currentTabId, url: currentResult.url, whisky: currentResult.whisky });
  });
  return button;
}

// After a failed search (rate limiting or another check, say): the background opens the
// search in a tab and reads the results from it once they load there.
function openSearchButton() {
  const button = el('button', { type: 'button', className: 'wb-retry wb-primary' }, 'Search on Whiskybase');
  button.addEventListener('click', () => {
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'whisky:open-search', tabId: currentTabId, url: currentResult.url, whisky: currentResult.whisky });
  });
  return button;
}

function switchTabButton(tabId) {
  const button = el('button', { type: 'button', className: 'wb-retry' }, 'Go to the Whiskybase tab');
  button.addEventListener('click', () => chrome.tabs.update(tabId, { active: true }));
  return button;
}

// Asks Chrome to give back the access to Whiskybase (removed in Chrome's site
// access settings, for example), then searches again.
function accessButton() {
  const button = el('button', { type: 'button', className: 'wb-retry' }, 'Allow access to Whiskybase');
  button.addEventListener('click', async () => {
    button.disabled = true;
    // Asked straight away: Chrome only shows the prompt during the click.
    if (await chrome.permissions.request({ origins: Whiskybase.HOSTS })) {
      chrome.runtime.sendMessage({ type: 'whisky:retry', tabId: currentTabId, url: currentResult.url, whisky: currentResult.whisky });
    } else {
      button.disabled = false;
    }
  });
  return button;
}

// Manual search opens Whiskybase's own results page for the query in a new tab.
$('wb-run').addEventListener('click', () => {
  if (currentQuery) chrome.tabs.create({ url: Whiskybase.searchUrl(currentQuery) });
});

chrome.storage.onChanged.addListener((changes, area) => {
  const key = `lookup:${currentTabId}`;
  if (area === 'session' && changes[key]) {
    currentLookup = changes[key].newValue || null;
    renderWhiskybase();
  }
});

// The page's detector, loaded into the tab first if it isn't there yet:
// clicking the toolbar icon gives the extension access to this tab (activeTab).
async function detection(tabId, rescan) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'whisky:get', rescan });
  try {
    const result = await ask();
    if (result) return result;
  } catch (e) {
    // Not loaded yet (or left over from before the extension was reloaded).
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/detector.js', 'src/content.js'] });
  return ask();
}

async function scan(rescan) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  const key = `lookup:${tab.id}`;
  currentLookup = (await chrome.storage.session.get(key))[key] || null;
  // Whiskybase itself: nothing to scan, and nothing to look up.
  if (Whiskybase.isWhiskybasePage(tab.url)) {
    $('fields').hidden = true;
    $('why').hidden = true;
    $('rescan').hidden = true;
    $('parsed-title').textContent = 'Whiskybase';
    $('status').hidden = false;
    $('status').className = 'status';
    $('status').textContent = 'You’re looking at Whiskybase — no more information to show.';
    return;
  }
  try {
    currentResult = await detection(tab.id, rescan);
    render(currentResult);
  } catch (e) {
    $('fields').hidden = true;
    $('why').hidden = true;
    $('parsed-title').textContent = 'No whisky information detected';
    showStatus(
      'none',
      'Cannot inspect this page',
      /^file:/.test(tab.url || '')
        ? 'For local files, turn on Allow access to file URLs on the extension’s details page.'
        : 'Browser pages and the Chrome Web Store cannot be scanned.'
    );
  }
}

// --- Automatic checking -------------------------------------------------------
// Off: pages are only checked when the toolbar icon is clicked. On: the optional
// access to all sites is granted, autoCheck is set, and the background
// registers the detector on every page. Chrome may close the popup for its
// permission prompt; the background turns the setting on when it is accepted.
// Turning it off keeps the access (see background.js for why).

const ALL_SITES = ['http://*/*', 'https://*/*'];

async function showAutoCheck() {
  const { autoCheck } = await chrome.storage.local.get('autoCheck');
  $('auto-check').checked = !!autoCheck && (await chrome.permissions.contains({ origins: ALL_SITES }));
}

$('auto-check').addEventListener('change', async (e) => {
  try {
    if (e.target.checked) {
      // Asked straight away: Chrome only shows the prompt during the click.
      if (await chrome.permissions.request({ origins: ALL_SITES })) await chrome.storage.local.set({ autoCheck: true });
    } else {
      await chrome.storage.local.set({ autoCheck: false });
    }
  } finally {
    showAutoCheck();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoCheck) showAutoCheck();
});

// --- Debugging ------------------------------------------------------------------
// Set from the service worker's console (see background.js); only then is this shown.

async function showDebug() {
  $('debug-note').hidden = !(await chrome.storage.local.get('debugSimulateSearchFailure')).debugSimulateSearchFailure;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debugSimulateSearchFailure) showDebug();
});

$('rescan').addEventListener('click', () => scan(true));
showAutoCheck();
showDebug();
scan(false);
