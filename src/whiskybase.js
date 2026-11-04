/*
 * Whiskybase helpers: builds a search query from a detection result and
 * reads a Whiskybase search response.
 *
 * No dependencies and no DOM, so the same file runs in the background service
 * worker (importScripts), the popup and Node tests.
 */
(function (root) {
  'use strict';

  const SEARCH_URL = 'https://www.whiskybase.com/search?q=';
  const WHISKY_URL = 'https://www.whiskybase.com/whiskies/whisky/';
  // The hosts the extension needs access to: pages, and bottle photos (as host_permissions in manifest.json).
  const HOSTS = ['https://www.whiskybase.com/*', 'https://static.whiskybase.com/*'];

  function clean(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  }

  // Words in bottler names that don't help a search.
  const BOTTLER_NOISE_RE =
    /\s*\([^)]*\)|\b(?:ltd|limited|co|company|inc|gmbh|bv|wine\s*&\s*spirits|spirits|distillers|whisky\s+company)\b\.?/gi;

  /**
   * Short query from the detected fields: distillery (or brand/name), vintage,
   * age, independent bottler and cask number. Shop noise from the product title
   * (size, ABV, site name) is left out.
   */
  function buildQuery(w) {
    if (!w) return '';
    const parts = [];
    const isSmws = /scotch\s+malt\s+whisky\s+society|\bsmws\b/i.test(w.bottler || '');
    if (isSmws && w.caskNumber) {
      // SMWS bottles are known by their cask code; the shop name says nothing.
      parts.push(`SMWS ${w.caskNumber}`);
      if (w.vintage) parts.push(String(w.vintage));
      if (w.abv) parts.push(`${w.abv}%`);
      return parts.join(' ');
    }

    // A sub-brand (Port Charlotte at Bruichladdich) is how Whiskybase names the bottle.
    const subject = w.brand || w.distillery || w.name;
    parts.push(
      clean(subject)
        .replace(/\b\d+(?:[.,]\d+)?\s*(?:cl|ml|l)\b/gi, '')
        .replace(/\b\d{2}(?:[.,]\d{1,2})?\s*%(?:\s*vol\.?)?/gi, '')
    );
    if (w.vintage) parts.push(String(w.vintage));
    if (w.age) parts.push(String(w.age));
    if (w.bottling === 'independent' && w.bottler) {
      const bottler = clean(w.bottler.replace(BOTTLER_NOISE_RE, ' ')).replace(/^(?:the|that)\s+/i, '');
      if (bottler) parts.push(bottler);
    }
    if (w.caskNumber) parts.push(String(w.caskNumber));
    // Whiskybase filters on a strength in the query, which narrows results a lot.
    if (w.abv) parts.push(`${w.abv}%`);
    return clean([...new Set(parts.map(clean).filter(Boolean))].join(' '));
  }

  /** The ID as Whiskybase shows it: "WB233907". */
  function displayId(id) {
    return `WB${id}`;
  }

  function searchUrl(query) {
    return SEARCH_URL + encodeURIComponent(query);
  }

  const num = (v) => {
    const m = String(v == null ? '' : v).match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  };
  const year = (v) => {
    const m = String(v == null ? '' : v).match(/(?:19|20)\d{2}/);
    return m ? +m[0] : null;
  };

  /**
   * Only real bottle photos are worth showing: not Whiskybase's placeholder
   * (storage/whiskies/default/…) and not the social card (…/card/<id>.png).
   */
  function isBottlePhoto(url) {
    const u = String(url || '');
    return (
      /^https:\/\/(?:[a-z0-9-]+\.)*whiskybase\.com\//i.test(u) &&
      !/\/default\/|\/card\/|placeholder|no-?photo/i.test(u) &&
      (/\/storage\//i.test(u) || /\.(?:png|jpe?g|webp|avif|gif)(?:[?#]|$)/i.test(u))
    );
  }

  /** Whether a photo URL is in the folder of bottle `id` (WB304211 → …/storage/whiskies/3/0/4211/…). */
  function isPhotoOf(url, id) {
    const d = String(id || '');
    return d.length > 2 && String(url || '').includes(`/storage/whiskies/${d[0]}/${d[1]}/${d.slice(2)}/`);
  }

  /** The same photo in other sizes Whiskybase keeps (…-normal.png, …-big.jpg, …-small.png). */
  function photoVariants(url) {
    const m = String(url || '').match(/^(.*-)(normal|big|small)\.(png|jpe?g)(\?.*)?$/i);
    if (!m) return [url].filter(Boolean);
    // Normal size first: big enough for the popup, much smaller than "big".
    return [`${m[1]}normal.png`, url, `${m[1]}big.jpg`, `${m[1]}small.png`].filter((v, i, a) => a.indexOf(v) === i);
  }

  /** A bottle from Whiskybase's search data, in the same terms as the detector. */
  function fromSearchData(b) {
    const volume = String(b.bottle_size || '').match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/i);
    const factor = volume ? { ml: 1, cl: 10, l: 1000 }[volume[2].toLowerCase()] : 0;
    return {
      id: String(b.id),
      url: b.url || WHISKY_URL + b.id,
      text: clean(b.display_name_mobile) || clean(`${b.brand || ''} ${b.name || ''}`),
      brand: clean(b.brand),
      name: clean(b.name),
      bottler: clean(b.bottler),
      series: clean(b.bottler_serie),
      caskType: clean(b.cask_type),
      age: num(b.age) || num(b.calculated_age),
      vintage: year(b.vintage_year || b.vintage_date),
      bottled: year(b.bottle_year || b.bottle_date),
      abv: num(b.strength),
      volumeMl: volume ? Math.round(num(volume[1]) * factor) : null,
      caskNumber: clean(b.cask_number),
      barcode: clean(b.barcode),
      rating: num(b.rating) || null, // "0.00" means not rated
      photo:
        [].concat(typeof b.photo === 'string' ? b.photo : b.photo ? [b.photo.normal, b.photo.big, b.photo.small] : []).find(isBottlePhoto) ||
        null,
    };
  }

  const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', euro: '€', pound: '£', dollar: '$' };

  /** Decodes HTML entities (enough for attribute values and link text). */
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
    });
  }

  const stripTags = (s) => clean(decodeEntities(String(s).replace(/<[^>]*>/g, ' ')));

  /** Bottles from the data Whiskybase embeds in <search :search-results="{json}">. */
  function readSearchData(html) {
    const m = html.match(/\s:search-results="([^"]*)"/);
    if (!m) return null;
    let data;
    try {
      data = JSON.parse(decodeEntities(m[1]));
    } catch (e) {
      return null;
    }
    const paginator = data && data.entities && data.entities.bottles && data.entities.bottles.paginator;
    if (!paginator || !Array.isArray(paginator.data)) return null;
    return { total: paginator.total || paginator.data.length, bottles: paginator.data.map(fromSearchData) };
  }

  /**
   * What a search response contains: whether it is a Cloudflare challenge, and
   * the whisky results. Results come from the embedded search data when present
   * (with all fields), otherwise from links to whisky pages ({ id, url, text }).
   * Works on the raw HTML string, so it also runs in the service worker.
   */
  function analyseSearchHtml(html) {
    html = String(html || '');
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';
    const challenge =
      /just a moment|attention required|security verification/i.test(title) ||
      /id="challenge-form"|id="cf-challenge-running"|name="cf-turnstile-response"|challenges\.cloudflare\.com/i.test(html) ||
      /performing security verification|checking your browser|verify you are (?:a )?human/i.test(html.slice(0, 20000));

    const data = readSearchData(html);
    if (data) return { title, challenge, total: data.total, whiskies: data.bottles };

    const seen = new Map();
    const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const [, attrs, inner] of html.matchAll(linkRe)) {
      const href = (attrs.match(/\bhref="([^"]*)"/i) || [])[1] || '';
      const m = decodeEntities(href).match(/\/whiskies\/whisky\/(\d+)(?:\/([^?#"]*))?/);
      if (!m) continue;
      const id = m[1];
      const linkText = stripTags(inner) || stripTags((attrs.match(/\btitle="([^"]*)"/i) || [])[1] || '');
      const prev = seen.get(id);
      if (!prev) seen.set(id, { id, url: WHISKY_URL + id + (m[2] ? '/' + m[2] : ''), text: linkText });
      else if (!prev.text && linkText) prev.text = linkText;
    }
    return { title, challenge, total: seen.size, whiskies: [...seen.values()] };
  }

  /**
   * Details from a Whiskybase bottle page: the rating and how many ratings it
   * is based on (from its JSON-LD aggregateRating), and the bottle photo: the
   * JSON-LD image (the default photo), else the first photo in the page's
   * carousel (uploaded but not marked as default, e.g. only a label shot).
   * og:image is a social card, not the bottle.
   */
  function analyseBottleHtml(html) {
    html = String(html || '');
    const out = {
      challenge: analyseSearchHtml(html).challenge,
      rating: null,
      reviews: null,
      photo: null,
      price: null,
      shops: null,
      // For explaining a missing price: was the page served signed in, and did it have a price block?
      signedIn: /href="[^"]*\/logout[?"]/i.test(html),
      priceBlock: /Average Shop Price\s*<\/p>/i.test(html),
    };
    const find = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.aggregateRating) return node.aggregateRating;
      for (const v of Object.values(node)) {
        const r = find(v);
        if (r) return r;
      }
      return null;
    };
    for (const [, json] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      let data;
      try {
        data = JSON.parse(json);
      } catch (e) {
        continue;
      }
      const agg = find(data);
      if (agg && out.rating == null) {
        out.rating = num(agg.ratingValue) ? Math.round(num(agg.ratingValue) * 100) / 100 : null;
        out.reviews = num(agg.reviewCount || agg.ratingCount);
      }
      const image = [].concat((data && data.image) || []).map((i) => (i && i.url) || i).find(isBottlePhoto);
      if (image && !out.photo) out.photo = image;
    }
    if (!out.photo) {
      // Only photos in this bottle's own folder, never those of related bottles on the page.
      const id = (html.match(/rel="canonical" href="https:\/\/www\.whiskybase\.com\/whiskies\/whisky\/(\d+)/) || [])[1];
      const start = html.search(/id="carousel-whisky"/);
      const carousel = start >= 0 ? html.slice(start, start + 20000) : '';
      for (const [, u] of carousel.matchAll(/(?:href|src)="(https:\/\/[^"]+)"/g)) {
        const url = decodeEntities(u);
        if (isBottlePhoto(url) && (!id || isPhotoOf(url, id))) {
          out.photo = url;
          break;
        }
      }
    }
    // Average Shop Price, only while shops list the bottle ("Available at N shops");
    // without listings the page shows the last known price instead.
    const shops = html.match(/Available at\s*(?:<strong>)?\s*(\d+)\s*(?:<\/strong>)?\s*shops?/i);
    const price = html.match(/<p>\s*Average Shop Price\s*<\/p>[\s\S]{0,300}?<p>([^<]*\d[^<]*)<\/p>/i);
    if (shops && +shops[1] > 0 && price) {
      out.shops = +shops[1];
      out.price = clean(decodeEntities(price[1]));
    }
    if (out.rating == null) {
      const m = html.match(/"rating":"(\d+(?:\.\d+)?)","votes":(\d+)/);
      if (m && +m[1] > 0) {
        out.rating = +m[1];
        out.reviews = +m[2];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Matching a detected bottle against search results

  function norm(s) {
    return clean(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const digits = (s) => (String(s || '').match(/\d+/g) || []).join('');
  const isDistilleryBottling = (b) => !b || /distillery\s+bottling|official\s+bottling/i.test(b);

  // Lower than this, or not far enough ahead of the runner-up, is no match.
  const MIN_SCORE = 6;
  const MIN_MARGIN = 3;

  /**
   * Scores one result against the detected bottle. Agreement adds points; a
   * clear contradiction (different ABV, age, vintage, bottler) costs more than
   * agreement earns, because Whiskybase often lists near-identical releases.
   */
  function scoreResult(w, r) {
    const reasons = [];
    let score = 0;
    const add = (points, text) => {
      score += points;
      reasons.push({ points, text });
    };

    if (w.gtin && r.barcode && digits(w.gtin) === digits(r.barcode)) add(10, 'Same barcode');

    if (w.abv && r.abv) {
      if (Math.abs(w.abv - r.abv) <= 0.05) add(4, `Same ABV ${r.abv}%`);
      else if (Math.abs(w.abv - r.abv) > 0.15) add(-6, `Different ABV ${r.abv}%`);
    }
    if (w.age && r.age) {
      if (w.age === r.age) add(2, `Same age ${r.age}`);
      else add(-4, `Different age ${r.age}`);
    }
    if (w.vintage && r.vintage) {
      if (w.vintage === r.vintage) add(2, `Same vintage ${r.vintage}`);
      else add(-4, `Different vintage ${r.vintage}`);
    }
    if (w.bottled && r.bottled) {
      if (w.bottled === r.bottled) add(1, `Same bottling year ${r.bottled}`);
      else add(-2, `Different bottling year ${r.bottled}`);
    }
    if (w.caskNumber && r.caskNumber && digits(w.caskNumber)) {
      if (digits(w.caskNumber) === digits(r.caskNumber)) add(4, `Same cask ${r.caskNumber}`);
      else add(-3, `Different cask ${r.caskNumber}`);
    }
    if (w.volumeMl && r.volumeMl) {
      if (w.volumeMl === r.volumeMl) add(0.5, `Same size ${r.volumeMl} ml`);
      else add(-1, `Different size ${r.volumeMl} ml`);
    }

    const subject = norm(w.brand || w.distillery || '');
    if (subject && r.brand) {
      if (norm(r.brand) === subject || norm(r.brand).includes(subject) || subject.includes(norm(r.brand))) {
        add(2, `Same distillery/brand ${r.brand}`);
      } else {
        add(-4, `Different distillery/brand ${r.brand}`);
      }
    }

    if (r.bottler) {
      const wb = norm(w.bottler || '');
      const rb = norm(r.bottler);
      if (w.bottling === 'independent' && wb) {
        if (isDistilleryBottling(r.bottler)) add(-4, 'Whiskybase lists a distillery bottling');
        else if (rb.includes(wb) || wb.includes(rb) || words(wb).some((x) => words(rb).includes(x))) {
          add(2, `Same bottler ${r.bottler}`);
        } else add(-4, `Different bottler ${r.bottler}`);
      } else if (w.bottling === 'distillery' && !isDistilleryBottling(r.bottler)) {
        // Weaker: a distillery bottling is often only assumed.
        add(w.bottlerSource === 'assumed' ? -1 : -3, `Whiskybase lists bottler ${r.bottler}`);
      }
    }

    // Distinctive words from the Whiskybase name and series that also appear in
    // the shop's product name ("Madeira Finish", "Cask Craft").
    const pageWords = new Set(words(`${w.name} ${w.brand}`));
    const skip = new Set([...words(r.brand), ...words(r.bottler), ...words(w.distillery)]);
    const hits = (text) => [...new Set(words(text))].filter((x) => !skip.has(x) && !/^\d+$/.test(x) && pageWords.has(x));
    const nameHits = hits(r.name);
    if (nameHits.length) add(Math.min(3, nameHits.length), `Name words match: ${nameHits.join(', ')}`);
    const seriesHits = hits(r.series);
    if (seriesHits.length) add(Math.min(2, seriesHits.length), `Series words match: ${seriesHits.join(', ')}`);

    return { score, reasons };
  }

  /**
   * Ranks results against the detected bottle. `match` is the best result when
   * it scores at least MIN_SCORE and beats the runner-up by MIN_MARGIN,
   * otherwise null (no confident match).
   */
  function matchResults(w, results) {
    const ranked = results
      .map((r) => ({ ...r, ...scoreResult(w, r) }))
      .sort((a, b) => b.score - a.score);
    const [best, second] = ranked;
    const confident =
      !!best && best.score >= MIN_SCORE && (!second || best.score - second.score >= MIN_MARGIN);
    return { match: confident ? best : null, ranked };
  }

  const api = { MIN_SCORE, MIN_MARGIN, buildQuery, searchUrl, displayId, analyseSearchHtml, analyseBottleHtml, isBottlePhoto, isPhotoOf, photoVariants, matchResults, scoreResult, SEARCH_URL, WHISKY_URL, HOSTS };
  root.Whiskybase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
