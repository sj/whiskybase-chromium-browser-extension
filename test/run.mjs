// Test runner. No dependencies:
//  - parser unit tests run directly in Node
//  - fixture pages are run through the detector in headless Chromium/Chrome
//
// Usage: node test/run.mjs [-v]      (set CHROME_BIN to pick a browser)

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('-v');
const require = createRequire(import.meta.url);
const D = require('../src/detector.js');
const WB = require('../src/whiskybase.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}\n        ${e.message.split('\n').join('\n        ')}`);
  }
}

// ---------------------------------------------------------------------------
console.log('Parsers');

const parserCases = [
  ['parseAbv', ['Bottled at 46% vol'], 46],
  ['parseAbv', ['Alcoholpercentage: 43,0 %'], 43],
  ['parseAbv', ['ABV 57.1%'], 57.1],
  ['parseAbv', ['90 Proof'], 45],
  ['parseAbv', ['20% off this week'], null],
  ['parseAbv', ['Single Malt Scotch Whisky | 70cl | 45.8%'], 45.8],
  ['parseAbv', ['52,3% 0,7 l'], 52.3],
  ['parseAbv', ['Save 25% on 70cl bottles'], null],
  ['parseAbv', ['Caol Ila 25 52,1% 0,7l', true], 52.1],
  ['parseFallbackAbv', ['Cask strength 57.3%'], 57.3],
  ['parseFallbackAbv', ['Strength 46 %'], 46],
  ['parseFallbackAbv', ['40%'], null],
  ['parseFallbackAbv', ['Black Friday: 50% off everything'], null],
  ['parseFallbackAbv', ['Sale -50% | 46%'], 46],
  ['parseFallbackAbv', ['Up to 45% korting'], null],
  ['parseFallbackAbv', ['48% of reviewers recommend this'], null],
  ['parseFallbackAbv', ['48% of reviewers, bottled at 55.1%'], 55.1],
  ['parseVolume', ['70cl'], 700],
  ['parseVolume', ['0,7 l'], 700],
  ['parseVolume', ['Size: 750ml'], 750],
  ['parseVolume', ['1.75 L'], 1750],
  ['parseVolume', ['46% vol'], null],
  ['parseVolume', ['matured in a 200 litre barrel'], null],
  ['parseStandardVolume', ['Cask 14148 46% 70cl Sold'], 700],
  ['parseStandardVolume', ['Also available as 1 Litre'], 1000],
  ['parseStandardVolume', ['0,5l'], 500],
  ['parseStandardVolume', ['Size 750ml, sample 5cl'], null],
  ['parseAge', ['Lagavulin 16 Year Old'], 16],
  ['parseAge', ['Glenfarclas 15 Jaar'], 15],
  ['parseAge', ['Talisker 10yo'], 10],
  ['parseAge', ['Caol Ila 25 Jahre'], 25],
  ['parseAge', ['Ardbeg Uigeadail'], null],
  ['parseAge', ['Age: 12', true], 12],
  ['parseYears', ['Caol Ila 1998/2023'], { vintage: 1998, bottled: 2023 }],
  ['parseYears', ['Distilled 2008, bottled 2021'], { vintage: 2008, bottled: 2021 }],
  ['matchDistillery', ['The GlenDronach 18 Allardice'], 'GlenDronach'],
  ['matchDistillery', ['Makers Mark 46'], "Maker's Mark"],
  ['matchDistillery', ['Laphroaig Quarter Cask'], 'Laphroaig'],
  ['matchDistillery', ['Obanian Holidays'], null],
  ['matchBottler', ['Mortlach 2008 Connoisseurs Choice'], 'Gordon & MacPhail'],
  ['matchBottler', ['Cadenhead\'s Authentic Collection'], 'Cadenhead'],
  ['matchBottler', ['Carn Mor Strictly Limited'], 'Càrn Mòr'],
  ['matchBottler', ['Ardbeg 10 Year Old'], null],
  ['matchSubBrand', ['Signatory Vintage Ledaig 2008'], { brand: 'Ledaig', distillery: 'Tobermory' }],
  ['matchSubBrand', ['Redbreast 12 Cask Strength'], { brand: 'Redbreast', distillery: 'Midleton' }],
  ['matchSubBrand', ['Bruichladdich Classic Laddie'], null],
  ['matchDistillery', ['Port Charlotte 10'], null],
  ['matchBottler', ['Inchgower 1980 First Cask 24 Year Old'], 'First Cask'],
  ...[
    // brand fallback: bottler unless it is the shop itself
    [{ brand: 'Whisky Picnic Club', url: 'https://shop.test/x', title: 'Ardbeg 2010 | Shop' }, 'Whisky Picnic Club'],
    [{ brand: 'Whisky Warehouse', url: 'https://www.whiskywarehouse.test/x', title: 'Ardbeg 2010' }, 'Distillery bottling'],
    [{ brand: 'Drinks Corner', url: 'https://dc.test/x', title: 'Ardbeg 2010 | Drinks Corner' }, 'Distillery bottling'],
    [{ brand: 'Single Malt Scotch Whisky', url: 'https://dc.test/x', title: 'Ardbeg 2010' }, 'Distillery bottling'],
    // "Company" field: an unknown company is the bottler, a distillery owner means an official bottling
    [{ pairs: [['Company', 'Acme Cask Selections Ltd']] }, 'Acme Cask Selections Ltd'],
    [{ pairs: [['Company', 'Diageo']] }, 'Distillery bottling'],
    [{ pairs: [['Subtitle', 'Kingsbury Wine & Spirits Co']] }, 'Kingsbury Wine & Spirits Co'],
  ].map(([o, want]) => [
    'detectBottler',
    [{ nameText: 'Ardbeg 2010', rawName: 'Ardbeg 2010', distillery: 'Ardbeg', pairs: [], specText: '', description: '', siteName: '', ...o }],
    want,
    (r) => r.bottler,
  ]),
  ['cleanTitle', ['Ardbeg 10 | The Dram Shop', 'The Dram Shop'], 'Ardbeg 10'],
  ['cleanTitle', ['Springbank 15 Year Old – Review'], 'Springbank 15 Year Old'],
];
for (const [fn, args, expected, pick = (r) => r] of parserCases) {
  check(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}) → ${JSON.stringify(expected)}`, () =>
    assert.deepEqual(pick(D[fn](...args)), expected)
  );
}

// ---------------------------------------------------------------------------
console.log('\nFixture pages');

// status: expected detection; whisky: fields that must match (RegExp or exact value)
const fixtureCases = [
  {
    file: 'shop-jsonld-ardbeg.html',
    query: 'Ardbeg 10 46%',
    status: 'whisky',
    whisky: { name: 'Ardbeg 10 Year Old', brand: '', distillery: 'Ardbeg', bottling: 'distillery', bottlerSource: 'brand', age: 10, abv: 46, volumeMl: 700, gtin: '5010494195286' },
  },
  {
    file: 'shop-microdata-nl.html',
    status: 'whisky',
    whisky: { name: 'Glenfarclas 15 Jaar', brand: '', bottling: 'distillery', age: 15, abv: 46, volumeMl: 700 },
  },
  {
    file: 'bourbon-og.html',
    status: 'whisky',
    whisky: { name: /^Buffalo Trace Kentucky Straight Bourbon Whiskey$/, distillery: 'Buffalo Trace', bottling: 'distillery', bottlerSource: 'assumed', abv: 45, volumeMl: 750 },
  },
  { file: 'review-blog.html', status: ['whisky', 'possible'], whisky: { name: 'Springbank 15 Year Old', bottling: 'distillery', bottlerSource: 'assumed', age: 15, abv: 46 } },
  {
    file: 'independent-bottling.html',
    status: 'whisky',
    whisky: { distillery: 'Caol Ila', bottler: 'Signatory Vintage', bottling: 'independent', age: 25, abv: 52.1, volumeMl: 700, vintage: 1998, bottled: 2023 },
  },
  {
    file: 'bottler-gm-mortlach.html',
    status: 'whisky',
    whisky: { distillery: 'Mortlach', brand: '', bottler: 'Gordon & MacPhail', bottling: 'independent', vintage: 2008, abv: 46 },
  },
  {
    file: 'bottler-unknown-name.html',
    status: 'whisky',
    whisky: { distillery: 'Ardbeg', bottler: 'Whisky Picnic Club', bottling: 'independent', bottlerSource: 'spec', age: 13 },
  },
  {
    file: 'bottler-official-text.html',
    status: 'whisky',
    whisky: { distillery: 'Lagavulin', brand: '', bottler: 'Distillery bottling', bottling: 'distillery', bottlerSource: 'text' },
  },
  { file: 'bottler-unknown.html', status: 'whisky', whisky: { distillery: null, bottler: null, bottling: 'unknown', age: 30 } },
  {
    file: 'whiskyauctioneer.com-inchgower-lot-5291301.html',
    query: 'Inchgower 1980 24 First Cask 14148 46%',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', brand: '', bottler: 'First Cask (UK)', bottling: 'independent', age: 24, vintage: 1980, volumeMl: 700 },
  },
  {
    file: 'whiskyauctioneer.com-glendronach-independent-lot-5264156.html',
    query: 'GlenDronach 1991 34 Kingsbury 2266 44.8%',
    status: 'whisky',
    whisky: { distillery: 'GlenDronach', bottler: 'Kingsbury Wine & Spirits Co', bottling: 'independent', age: 34, vintage: 1991 },
  },
  {
    file: 'smws-3-369.html',
    query: 'SMWS 3.369 2004 54%',
    status: 'whisky',
    whisky: {
      name: 'Tempest in the tropics',
      bottler: 'Scotch Malt Whisky Society',
      bottling: 'independent',
      bottlerSource: 'site',
      caskNumber: '3.369',
      age: 22,
      abv: 54,
      vintage: 2004,
    },
  },
  {
    file: 'sub-brand-port-charlotte.html',
    query: 'Port Charlotte 10 50%',
    status: 'whisky',
    whisky: { brand: 'Port Charlotte', distillery: 'Bruichladdich', bottling: 'distillery', bottlerSource: 'brand', age: 10 },
  },
  {
    file: 'brand-no-distillery.html',
    status: 'whisky',
    whisky: { brand: 'Smokehead', distillery: null, bottling: 'unknown' },
  },
  {
    file: 'master-of-malt-inchgower-12-tbwc.html',
    query: 'Inchgower 12 Boutique-y 45.8%',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', bottling: 'independent', age: 12, abv: 45.8, volumeMl: 700 },
  },
  {
    file: 'masterofmalt.com-inchgower-murray-mcdavid-product-page.html',
    query: 'Inchgower Murray McDavid 44.5%',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', bottler: 'Murray McDavid', bottling: 'independent', abv: 44.5 },
  },
  {
    file: 'masterofmalt.com-inchgower-signatory-cask-106-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', bottler: 'Signatory', bottling: 'independent', age: 14, vintage: 2011 },
  },
  {
    file: 'masterofmalt.com-inchgower-coopers-choice-cask-803818-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', age: 11, caskNumber: '803818' },
  },
  {
    file: 'royalmilewhiskies-chichibu-cask-8238-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Chichibu', caskNumber: '8238', vintage: 2017, abv: 59.5, volumeMl: 700 },
  },
  {
    file: 'royalmilewhiskies-karuizawa-cask-3330-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Karuizawa', caskNumber: '3330' },
  },
  {
    file: 'htfw.com-inchgower-cask-2289-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', caskNumber: '2289' },
  },
  {
    file: 'htfw.com-inchgower-james-eadie-cask-348039-product-page.html',
    status: 'whisky',
    whisky: { distillery: 'Inchgower', bottler: 'James Eadie', bottling: 'independent', caskNumber: '348039', vintage: 2009, age: 12, abv: 58.7 },
    query: 'Inchgower 2009 12 James Eadie 348039 58.7%',
  },
  {
    file: 'hedonism-glendronach-old-kingsbury-1991.html',
    status: 'whisky',
    whisky: { distillery: 'GlenDronach', bottler: 'Kingsbury', vintage: 1991, age: 34, abv: 44.8 },
  },
  { file: 'category-listing.html', status: 'none' },
  { file: 'gin-product.html', status: 'none' },
  { file: 'sherry-product.html', status: 'none' },
  { file: 'news-article.html', status: 'none' },
  { file: 'bourbon-vanilla-lotion.html', status: 'none' },
];

function findBrowser() {
  const candidates = [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const bin of candidates.filter(Boolean)) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {}
  }
  throw new Error('No Chromium/Chrome found; set CHROME_BIN');
}

// Build one harness page that parses every fixture with DOMParser, runs the
// detector on it, and writes the results (base64 JSON) into the page. The
// harness lives inside the project (not /tmp) so a snap-packaged Chromium can read it.
function runFixtures(files) {
  const outDir = join(here, '.out');
  mkdirSync(outDir, { recursive: true });
  const fixtures = Object.fromEntries(files.map((f) => [f, readFileSync(join(here, 'fixtures', f), 'utf8')]));
  const script = (name) =>
    `<script>${readFileSync(join(here, '..', 'src', name), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
  const harness = `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre>
${script('detector.js')}
<script>
  const fixtures = ${JSON.stringify(fixtures).replace(/</g, '\\u003c')};
  const results = {};
  for (const [file, html] of Object.entries(fixtures)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      results[file] = WhiskyDetector.detect(doc, { url: 'https://example.test/' + file });
    } catch (e) {
      results[file] = { error: String(e && e.stack || e) };
    }
  }
  document.getElementById('out').textContent =
    'RESULTS:' + btoa(unescape(encodeURIComponent(JSON.stringify(results)))) + ':END';
</script>`;
  const harnessPath = join(outDir, 'harness.html');
  writeFileSync(harnessPath, harness);
  // GitHub's Ubuntu runners don't allow Chrome's sandbox; it only loads our own local test page.
  const ciFlags = process.env.CI ? ['--no-sandbox'] : [];
  const dom = execFileSync(findBrowser(), ['--headless', '--disable-gpu', ...ciFlags, '--dump-dom', pathToFileURL(harnessPath).href], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60000,
    // The dumped DOM contains every embedded fixture, so it can be several MB.
    maxBuffer: 256 * 1024 * 1024,
  });
  const m = dom.match(/RESULTS:([A-Za-z0-9+/=]+):END/);
  if (!m) throw new Error('Harness produced no results:\n' + dom.slice(0, 2000));
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

// Whiskybase pages: expected challenge flag and whisky IDs in order.
const whiskybaseCases = [
  { file: 'whiskybase/challenge.html', challenge: true, ids: [] },
  { file: 'whiskybase/results-synthetic.html', challenge: false, ids: ['1', '12345', '67890'] },
  {
    file: 'whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-search-results.html',
    challenge: false,
    ids: ['301898', '277515', '261506', '257372', '209402', '118718', '233907', '162976'],
  },
];

// Bottle page + Whiskybase search results → expected Whiskybase ID (null: no confident match).
const matchCases = [
  {
    page: 'masterofmalt.com-inchgower-murray-mcdavid-product-page.html',
    search: 'whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-search-results.html',
    id: '233907',
  },
];

const results = runFixtures(fixtureCases.map((c) => c.file));
// Whiskybase parts need no DOM, so they run here in Node.
for (const r of Object.values(results)) if (!r.error) r.query = WB.buildQuery(r.whisky);
const searchPage = (file) => WB.analyseSearchHtml(readFileSync(join(here, 'fixtures', file), 'utf8'));
for (const c of fixtureCases) {
  const r = results[c.file];
  check(`${c.file} → ${[].concat(c.status).join('/')}`, () => {
    if (r.error) throw new Error(r.error);
    const detail = `got ${r.status} (score ${r.score})\n` + r.reasons.map((x) => `${x.points > 0 ? '+' : ''}${x.points}  ${x.text}`).join('\n');
    assert.ok([].concat(c.status).includes(r.status), detail);
    for (const [k, want] of Object.entries(c.whisky || {})) {
      const got = r.whisky[k];
      if (want instanceof RegExp) assert.match(String(got), want, `whisky.${k}`);
      else assert.deepEqual(got, want, `whisky.${k}`);
    }
    if (c.query !== undefined) assert.equal(r.query, c.query, 'Whiskybase query');
  });
  if (verbose && r && !r.error) {
    console.log(`        ${r.status} score=${r.score} query=${JSON.stringify(r.query)} ${JSON.stringify(r.whisky)}`);
    for (const x of r.reasons) console.log(`          ${x.points > 0 ? '+' : ''}${x.points}  ${x.text}`);
  }
}

console.log('\nWhiskybase pages');
for (const c of whiskybaseCases) {
  const r = searchPage(c.file);
  check(`${c.file} → ${c.challenge ? 'challenge' : `${c.ids.length} whiskies`}`, () => {
    assert.equal(r.challenge, c.challenge, 'challenge');
    assert.deepEqual(r.whiskies.map((w) => w.id), c.ids, 'whisky ids');
  });
}

check('buildQuery uses the vintage year', () => {
  assert.equal(WB.buildQuery({ distillery: 'Caol Ila', vintage: 1998, bottled: 2023, age: 25, abv: 52.1 }), 'Caol Ila 1998 25 52.1%');
  assert.equal(WB.buildQuery({ distillery: 'Ardbeg', abv: 46 }), 'Ardbeg 46%');
});

const SEARCH_MM = 'whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-search-results.html';
check('search results: photo, rating, unrated and placeholder photos', () => {
  const byId = Object.fromEntries(searchPage(SEARCH_MM).whiskies.map((w) => [w.id, w]));
  assert.equal(byId['233907'].rating, 81.43);
  assert.match(byId['233907'].photo, /^https:\/\/static\.whiskybase\.com\/.*450971-normal\.png$/);
  assert.equal(byId['301898'].rating, null, 'rating 0.00 means unrated');
  assert.equal(byId['257372'].photo, null, 'default placeholder photo is dropped');
});

check('bottle page: rating and number of reviews', () => {
  const html = readFileSync(join(here, 'fixtures', 'whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-bottle-page.html'), 'utf8');
  const d = WB.analyseBottleHtml(html);
  assert.equal(d.challenge, false);
  assert.equal(d.rating, 81.43);
  assert.equal(d.reviews, 78);
  assert.equal(d.photo, 'https://static.whiskybase.com/storage/whiskies/2/3/3907/450971-normal.png', 'photo from JSON-LD, not the og:image card');
});

check('bottle page: average shop price and number of shops', () => {
  const mm = WB.analyseBottleHtml(readFileSync(join(here, 'fixtures', 'whiskybase/masterofmalt.com-inchgower-murray-mcdavid-whiskybase-bottle-page.html'), 'utf8'));
  assert.equal(mm.price, '€ 34.90');
  assert.equal(mm.shops, 14);
  const htfw = WB.analyseBottleHtml(readFileSync(join(here, 'fixtures', 'whiskybase/htfw.com-inchgower-cask-2289-whiskybase-bottle-page-WB304211.html'), 'utf8'));
  assert.equal(htfw.price, '€ 107.76');
  assert.equal(htfw.shops, 3);
  const je = WB.analyseBottleHtml(readFileSync(join(here, 'fixtures', 'whiskybase/htfw.com-inchgower-james-eadie-cask-348039-whiskybase-bottle-page-WB210223.html'), 'utf8'));
  assert.equal(je.price, '€ 83.85');
  assert.equal(je.shops, 9);
  assert.equal(je.rating, 84.83);
  assert.equal(je.reviews, 11);
  const unlisted = WB.analyseBottleHtml('<p>Last Average Shop Price</p><div><p>&euro; 50.00</p></div>');
  assert.equal(unlisted.price, null, 'no price without current shop listings');
  assert.equal(je.signedIn, true, 'saved while signed in');
  assert.equal(je.priceBlock, true);
  assert.equal(unlisted.signedIn, false);
});

check('isBottlePhoto rejects the placeholder and the social card', () => {
  assert.ok(WB.isBottlePhoto('https://static.whiskybase.com/storage/whiskies/2/3/3907/450971-normal.png'));
  assert.ok(!WB.isBottlePhoto('https://static.whiskybase.com/storage/whiskies/default/normal.png?v7'));
  assert.ok(!WB.isBottlePhoto('https://www.whiskybase.com/whiskies/whisky/233907/card/233907.png'));
  assert.ok(!WB.isBottlePhoto(null));
  assert.ok(WB.isBottlePhoto('https://static.whiskybase.com/storage/photos/abc.webp'), 'other Whiskybase image paths');
  assert.ok(!WB.isBottlePhoto('https://evil.example/whiskybase.com/x.png'), 'only Whiskybase hosts');
});

check('photoVariants tries the other photo sizes, normal first', () => {
  assert.deepEqual(WB.photoVariants('https://static.whiskybase.com/storage/whiskies/3/0/4211/554159-big.jpg'), [
    'https://static.whiskybase.com/storage/whiskies/3/0/4211/554159-normal.png',
    'https://static.whiskybase.com/storage/whiskies/3/0/4211/554159-big.jpg',
    'https://static.whiskybase.com/storage/whiskies/3/0/4211/554159-small.png',
  ]);
});

check('bottle page without a default photo: first photo of this bottle in the carousel', () => {
  const html = readFileSync(join(here, 'fixtures', 'whiskybase/htfw.com-inchgower-cask-2289-whiskybase-bottle-page-WB304211.html'), 'utf8');
  const d = WB.analyseBottleHtml(html);
  assert.equal(d.photo, 'https://static.whiskybase.com/storage/whiskies/3/0/4211/554159-big.jpg');
  assert.ok(WB.isPhotoOf(d.photo, '304211'));
  assert.ok(!WB.isPhotoOf(d.photo, '233907'));
});

console.log('\nWhiskybase matching');
for (const c of matchCases) {
  const page = results[c.page];
  const m = page && !page.error ? WB.matchResults(page.whisky, searchPage(c.search).whiskies) : null;
  const r = m && { match: m.match && m.match.id, ranked: m.ranked.slice(0, 5) };
  check(`${c.page} → ${c.id ? '#' + c.id : 'no match'}`, () => {
    assert.ok(r, 'no match result (page detection failed)');
    const detail = r.ranked
      .map((x) => `#${x.id} ${x.score}  ${x.text}\n` + x.reasons.map((y) => `      ${y.points > 0 ? '+' : ''}${y.points}  ${y.text}`).join('\n'))
      .join('\n');
    assert.equal(r.match, c.id, detail);
  });
  if (verbose && r) {
    for (const x of r.ranked) {
      console.log(`        #${x.id} score ${x.score}  ${x.text}`);
      for (const y of x.reasons) console.log(`          ${y.points > 0 ? '+' : ''}${y.points}  ${y.text}`);
    }
  }
}

console.log(failures ? `\n${failures} failing` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
