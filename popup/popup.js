'use strict';

const $ = (id) => document.getElementById(id);

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

// Always shown: the bottler's name, "Inchgower (distillery bottling)", or "Unknown".
function bottlerCell(w) {
  if (w.bottling === 'independent' && w.bottler) return w.bottler;
  if (w.bottling === 'distillery') return `${w.distillery || w.brand || 'Distillery'} (distillery bottling)`;
  return 'Unknown';
}

// One line: "**Whisky bottle detected**. Confidence: 85%".
function showStatus(cls, title, detail) {
  const el = $('status');
  el.className = `status status-${cls}`;
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  el.append(strong, '.');
  if (detail) el.append(' ', detail);
}

function render(result) {
  const { status, whisky, reasons, score } = result;
  showStatus(status, STATUS_TEXT[status], status === 'none' ? '' : `Confidence: ${Math.round(result.confidence * 100)}%`);

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
  $('score').textContent = `(score: ${score})`;
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
 * "Details of Whiskybase match" (only for a confident match): how it scored,
 * how that compares with the thresholds and the runner-up, and what was
 * searched for.
 */
function matchDetails(lk) {
  const [best, second] = lk.candidates;
  const body = el('div', {});
  body.append(
    el('p', {}, 'Match ', link(best.url, Whiskybase.displayId(best.id)), ` scored ${best.score}:`),
    reasonList(best.reasons),
    el(
      'p',
      {},
      `Accepted: needs at least ${Whiskybase.MIN_SCORE} points` +
        (second
          ? ` and ${Whiskybase.MIN_MARGIN} more than the next best (${Whiskybase.displayId(second.id)}: ${second.score}, a lead of ${best.score - second.score}).`
          : '.')
    ),
    el('p', {}, `Searched for “${lk.query}”: ${lk.total} ${lk.total === 1 ? 'result' : 'results'}${lk.cached ? ' (cached)' : ''} · `, link(lk.searchUrl, 'open search'))
  );
  if (lk.match.photoNote) body.append(el('p', {}, lk.match.photoNote));
  if (lk.candidates.length > 1) {
    body.append(el('p', {}, 'Other candidates (hover for points):'), candidateList(lk.candidates.slice(1)));
  }
  return el('details', { className: 'wb-details muted' }, el('summary', {}, 'Details of Whiskybase match'), body);
}

function ratingText(m) {
  if (!m.rating) return 'Not rated yet on Whiskybase';
  const n = m.reviews != null ? ` (${m.reviews} ${m.reviews === 1 ? 'review' : 'reviews'})` : '';
  return `Rating ${m.rating.toFixed(2)} / 100${n}`;
}

// Photo on top, then name, ID and rating.
function matchCard(m) {
  const card = el('div', { className: 'wb-match' });
  if (m.photoData || m.photo) {
    const img = el('img', { src: m.photoData || m.photo, alt: m.text, className: 'wb-photo' });
    const a = link(m.url, img);
    a.className = 'wb-photo-link';
    img.addEventListener('error', () => a.remove());
    card.append(a);
  }
  card.append(
    el('p', { className: 'wb-name' }, m.text),
    el('p', { className: 'wb-id' }, link(m.url, Whiskybase.displayId(m.id))),
    el('p', { className: 'wb-rating' }, ratingText(m))
  );
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

  const out = $('wb-result');
  out.replaceChildren();

  if (!lk) {
    const auto = r.status === 'whisky' && r.confidence >= 0.9;
    out.append(
      el('p', { className: 'muted' }, auto ? 'Searching Whiskybase…' : 'Not searched automatically (confidence below 90%). Use Manual search.')
    );
  } else if (lk.state === 'searching') {
    out.append(el('p', { className: 'muted' }, 'Searching Whiskybase…'));
  } else if (lk.state === 'match') {
    out.append(matchCard(lk.match), matchDetails(lk));
  } else if (lk.state === 'nomatch') {
    out.append(el('p', { className: 'wb-bad' }, lk.total ? 'No confident match. Best candidates:' : 'No results.'));
    if (lk.candidates.length) out.append(candidateList(lk.candidates));
  } else if (lk.state === 'blocked') {
    out.append(
      el('p', { className: 'wb-bad' }, lk.paused ? 'Paused after a Cloudflare check.' : 'Blocked by the Cloudflare check.'),
      el('p', {}, 'Open the search, pass the check there yourself, then search again: ', link(lk.searchUrl, 'open search'))
    );
  } else {
    out.append(el('p', { className: 'wb-bad' }, `Search failed: ${lk.error || 'unknown error'}`));
  }
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

async function scan(rescan) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  const key = `lookup:${tab.id}`;
  currentLookup = (await chrome.storage.session.get(key))[key] || null;
  try {
    currentResult = await chrome.tabs.sendMessage(tab.id, { type: 'whisky:get', rescan });
    render(currentResult);
  } catch (e) {
    $('fields').hidden = true;
    $('why').hidden = true;
    showStatus('none', 'Cannot inspect this page', 'Browser pages cannot be scanned. If this is a normal web page, reload it.');
  }
}

$('rescan').addEventListener('click', () => scan(true));
scan(false);
