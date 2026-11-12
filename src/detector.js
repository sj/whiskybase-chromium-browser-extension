/*
 * Whisky page detector.
 *
 * Decides whether a document shows a single bottle of whisky and extracts
 * whatever details it can (name, distillery, age, ABV, volume, ...).
 *
 * It works on any Document (the live page, or one made with DOMParser), uses
 * only textContent (no layout), and has no dependencies, so the same file runs
 * as a content script and in the test harness.
 *
 * Detection is a points system. Every signal that fires is recorded in
 * `reasons`, so it is easy to see why a page was (not) recognised:
 *   - whisky context: whisky words or a known distillery in the product name,
 *     breadcrumbs, title, description
 *   - bottle evidence: structured product data, add-to-cart buttons, and
 *     bottle attributes such as ABV, volume and age statement
 *   - penalties: listing/category pages, other spirits (gin, rum, ...)
 */
(function (root) {
  'use strict';

  const VERSION = 1;

  const WHISKY_SRC =
    '\\b(?:whiske?y|whiskies|whiskeys|scotch|bourbon|single[\\s-]+malt|blended[\\s-]+malt|' +
    'single[\\s-]+grain|single[\\s-]+pot[\\s-]+still)\\b|ウイスキー|威士忌';
  const WHISKY_RE = new RegExp(WHISKY_SRC, 'i');
  // Same, minus the words that also mean other things (bourbon vanilla, Scotch tape, ...).
  const STRONG_WHISKY_RE = new RegExp(WHISKY_SRC.replace('scotch|bourbon|', ''), 'i');

  const OTHER_SPIRIT_RE =
    /\b(?:gin|rum|rhum|ron|vodka|wodka|cognac|armagnac|brandy|calvados|tequila|mezcal|grappa|liqueur|likeur|lik[öo]r|wine|wijn|wein|champagne|port|sherry|beer|bier|sake|jenever|genever|absinthe|baijiu|soju)\b/i;
  // The same words describing a cask ("Single Sherry Cask", "Port Finish",
  // "ex-Rum Barrel", "Wine Cask Matured") say nothing about the drink itself.
  const CASK_WORDS = '(?:casks?|butts?|hogsheads?|hhd|barrels?|barriques?|puncheons?|octaves?|wood|finish(?:ed)?|matured|seasoned)';
  const CASK_DRINK_RE = new RegExp(
    '\\bex[-\\s]?' + OTHER_SPIRIT_RE.source.slice(2, -2) + '\\b|\\b' + OTHER_SPIRIT_RE.source.slice(2, -2) +
      '(?:\\s+[a-z]+)?\\s+' + CASK_WORDS + '\\b',
    'gi'
  );

  const NOT_A_BOTTLE_RE =
    /\b(?:lotion|candle|soap|shampoo|shower|perfume|parfum|cologne|aftershave|sauce|marinade|bbq|tea|coffee|chocolate|fudge|glass(?:es)?|tumbler|decanter|book|t-shirt|shirt|hoodie|poster|tour|tasting\s+event|ticket)\b/i;

  // Distilleries, brands and well-known bottlers. Only matched against the
  // product name / brand, never against the whole page. Very generic words
  // (Powers, Lark, Mars, Waterford, ...) are left out on purpose.
  const DISTILLERIES = [
    // Scotland
    'Aberfeldy', 'Aberlour', 'Ailsa Bay', 'Allt-a-Bhainne', 'Ardbeg', 'Ardmore', 'Ardnamurchan', 'Arran',
    'Auchentoshan', 'Auchroisk', 'Aultmore', 'Balblair', 'Balmenach', 'Balvenie', 'Ben Nevis', 'Benriach',
    'Benrinnes', 'Benromach', 'Bladnoch', 'Blair Athol', 'Bowmore', 'Braeval', 'Brora', 'Bruichladdich',
    'Bunnahabhain', 'Caol Ila', 'Caperdonich', 'Cardhu', 'Clynelish', 'Cragganmore', 'Craigellachie',
    'Daftmill', 'Dailuaine', 'Dalmore', 'Dalwhinnie', 'Deanston', 'Dufftown', 'Edradour', 'Fettercairn',
    'Glen Elgin', 'Glen Garioch', 'Glen Grant', 'Glen Keith', 'Glen Moray', 'Glen Ord', 'Glen Scotia',
    'Glen Spey', 'Glenallachie', 'Glenburgie', 'Glencadam', 'GlenDronach', 'Glendullan', 'Glenfarclas',
    'Glenfiddich', 'Glenglassaugh', 'Glengoyne', 'Glenkinchie', 'Glenlivet', 'Glenlossie', 'Glenmorangie',
    'Glenrothes', 'Glentauchers', 'Glenturret', 'Glengyle', 'Highland Park', 'Inchgower', 'Isle of Jura',
    'Kilchoman', 'Kingsbarns', 'Knockando', 'Knockdhu', 'Lagavulin', 'Laphroaig',
    'Linkwood', 'Littlemill', 'Loch Lomond', 'Longmorn', 'Macallan', 'Macduff',
    'Mannochmore', 'Miltonduff', 'Mortlach', 'Oban', 'Pulteney',
    'Port Ellen', 'Rosebank', 'Royal Brackla', 'Royal Lochnagar', 'Scapa', 'Speyburn', 'Springbank',
    'Strathisla', 'Strathmill', 'Talisker', 'Tamdhu', 'Tamnavulin', 'Teaninich', 'Tobermory', 'Tomatin',
    'Tomintoul', 'Torabhaig', 'Tormore', 'Tullibardine', 'Wolfburn',
    // Scottish blends and blenders
    'Ballantine\'s', 'Chivas Regal', 'Compass Box', 'Dewar\'s', 'Johnnie Walker', 'Monkey Shoulder',
    'Famous Grouse', 'Big Peat',
    // Ireland
    'Bushmills', 'Midleton', 'Teeling', 'Tullamore',
    'Kilbeggan', 'Writers\' Tears',
    // USA
    'Buffalo Trace', 'Maker\'s Mark', 'Wild Turkey', 'Woodford Reserve', 'Four Roses', 'Heaven Hill',
    'Jim Beam', 'Jack Daniel\'s', 'George Dickel', 'Michter\'s', 'Old Forester', 'Bulleit',
    'Willett', 'Westland', 'Balcones',
    // Japan and Asia
    'Yamazaki', 'Hakushu', 'Hibiki', 'Yoichi', 'Miyagikyo', 'Nikka', 'Chichibu', 'Mars Shinshu',
    'Karuizawa', 'Hanyu', 'Komagatake', 'Akkeshi', 'Kanosuke', 'Shizuoka', 'Nagahama', 'Chita', 'Fuji Gotemba',
    'Kavalan', 'Amrut', 'Paul John',
    // Rest of the world
    'Mackmyra', 'Penderyn', 'Starward', 'Sullivans Cove', 'Millstone', 'Zuidam', 'Kalkwijck', 'Slyrs',
    'St. Kilian', 'Kornog', 'Armorik', 'Box Destilleri',
  ];

  // Brands that a distillery sells under a different name: brand → distillery.
  // Matched like distilleries; the popup shows them as Brand.
  const SUB_BRANDS = [
    ['Port Charlotte', 'Bruichladdich'],
    ['Octomore', 'Bruichladdich'],
    ['Longrow', 'Springbank'],
    ['Hazelburn', 'Springbank'],
    ['Kilkerran', 'Glengyle'],
    ['Ledaig', 'Tobermory'],
    ['anCnoc', 'Knockdhu'],
    ['Inchmurrin', 'Loch Lomond'],
    ['Inchmoan', 'Loch Lomond'],
    ['Croftengea', 'Loch Lomond'],
    ['Old Ballantruan', 'Tomintoul'],
    ['Jameson', 'Midleton'],
    ['Redbreast', 'Midleton'],
    ['Green Spot', 'Midleton'],
    ['Yellow Spot', 'Midleton'],
    ["Blanton's", 'Buffalo Trace'],
    ['Eagle Rare', 'Buffalo Trace'],
    ['Pappy Van Winkle', 'Buffalo Trace'],
    ['W.L. Weller', 'Buffalo Trace'],
    ['E.H. Taylor', 'Buffalo Trace'],
    ['Elijah Craig', 'Heaven Hill'],
    ['Evan Williams', 'Heaven Hill'],
    ['Knob Creek', 'Jim Beam'],
    ["Booker's", 'Jim Beam'],
    ["Baker's", 'Jim Beam'],
    ['Basil Hayden', 'Jim Beam'],
  ];

  // Independent bottlers: canonical name followed by aliases and series names
  // that only that bottler uses.
  const BOTTLERS = [
    ['Signatory Vintage', 'Signatory'],
    ['Gordon & MacPhail', 'Gordon and MacPhail', 'G&M', "Connoisseurs Choice"],
    ['Cadenhead', 'WM Cadenhead'],
    ['Douglas Laing', 'Old Particular', 'Xtra Old Particular'],
    ['Hunter Laing', 'Old Malt Cask', 'Old & Rare'],
    ['Adelphi'],
    ['Blackadder', 'Raw Cask'],
    ['Murray McDavid'],
    ['Elixir Distillers', 'Single Malts of Scotland', 'Speciality Drinks'],
    ['That Boutique-y Whisky Company', 'Boutique-y'],
    ['The Scotch Malt Whisky Society', 'Scotch Malt Whisky Society', 'SMWS'],
    ['Thompson Bros', 'Thompson Brothers'],
    ['Berry Bros & Rudd', 'Berry Bros', "Berrys'"],
    ['Duncan Taylor'],
    ['A.D. Rattray', 'AD Rattray'],
    ['Wemyss Malts'],
    ['Kingsbury'],
    ['Malts of Scotland'],
    ['The Whisky Agency', 'Whisky Agency'],
    ['Sansibar'],
    ['Whiskybase Archives'],
    ['Lady of the Glen'],
    ['North Star Spirits'],
    ['James Eadie'],
    ["Claxton's"],
    ['Dramfool'],
    ['The Whisky Sponge', 'Whisky Sponge'],
    ['Càrn Mòr'],
    ['Hart Brothers'],
    ["Chieftain's"],
    ['Mossburn'],
    ['Van Wees', 'The Ultimate Selection'],
    ['Svenska Eldvatten'],
    ['Single Cask Nation'],
    ['Kintra'],
    ['Watt Whisky'],
    ['Fadandel'],
    ['Jack Wiebers'],
    ['Valinch & Mallet'],
    ['Wilson & Morgan'],
    ['Silver Seal'],
    ['Samaroli'],
    ['Moon Import'],
    ["Mackillop's Choice"],
    ['James MacArthur'],
    ['Asta Morris'],
    ['Maltbarn'],
    ['Douglas of Drumlanrig'],
    ['Golden Cask'],
    ['Whisky-Fässle', 'Whisky Fassle'],
    ['First Cask'],
    ['Little Brown Dog Spirits', 'Little Brown Dog'],
    ['Whisky-Doris', 'Whisky Doris'],
  ];

  // Owners of distilleries: a brand like this means a distillery bottling.
  const OWNER_RE =
    /\b(?:diageo|pernod\s+ricard|chivas\s+brothers|beam\s+suntory|suntory|edrington|william\s+grant|brown-?forman|bacardi|john\s+dewar|lvmh|mo[eë]t\s+hennessy|distell|whyte\s+&\s+mackay|ian\s+macleod|campari|sazerac|emperador|angus\s+dundee|inver\s+house|burn\s+stewart|asahi|kirin|la\s+martiniquaise|picard)\b/i;

  // Official/distillery bottling phrases. "OB" is only trusted in a product name.
  const OFFICIAL_RE =
    /\b(?:official\s+bottling|distillery\s+bottling|original\s+bottling|originalabf[üu]llung|offizielle\s+abf[üu]llung|eigenabf[üu]llung|officiële\s+botteling|originele\s+botteling|embouteillage\s+officiel)\b/i;
  const OB_RE = /(?:^|[\s(\-–])OB(?=$|[\s),\-–])/;

  // Labels that introduce the bottler in a spec table or text.
  const BOTTLER_KEY_RE =
    /^(?:independent\s+)?(?:bottler|bottled\s+by|abf[üu]ller|bottelaar|gebotteld\s+door|embouteilleur|imbottigliatore|embotellador)\s*:?$/i;
  // Weaker than a bottler label: the company behind the bottling (bottler or distillery owner).
  const COMPANY_KEY_RE = /^(?:company|bottling\s+company|bedrijf|firma|unternehmen|soci[ée]t[ée])$/i;
  const BOTTLER_INLINE_RE =
    /\b(?:bottler|bottled\s+by|abf[üu]ller|bottelaar|gebotteld\s+door|embouteilleur|imbottigliatore|embotellador)\s*[:-]?\s*(.{2,60})/i;

  // Values that are a region or category rather than a bottler.
  const NOT_A_BOTTLER_RE =
    /\b(?:islay|speyside|highlands?|lowlands?|campbeltown|islands?|scotland|schotland|schottland|ireland|ierland|japan|usa|kentucky|tennessee|taiwan|india|unknown|onbekend|n\/a)\b/i;
  // Values made up only of category words, e.g. "Single Malt Scotch Whisky".
  const CATEGORY_ONLY_RE =
    /^(?:(?:single|blended|pure|malt|grain|pot|still|cask|strength|scotch|irish|japanese|american|straight|kentucky|whiske?y|bourbon|rye)[\s-]*)+$/i;

  function nameRe(name) {
    const pattern = norm(name)
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "'?"))
      .join('[\\s-]*');
    return new RegExp('(?:^|[^a-z0-9])' + pattern + '(?![a-z0-9])', 'i');
  }

  const DISTILLERY_RES = DISTILLERIES.map((name) => ({ name, re: nameRe(name) }));
  const SUB_BRAND_RES = SUB_BRANDS.map(([brand, distillery]) => ({ brand, distillery, re: nameRe(brand) }));
  const BOTTLER_RES = BOTTLERS.flatMap(([name, ...aliases]) =>
    [name, ...aliases].map((alias) => ({ name, re: nameRe(alias) }))
  );

  const CART_RE =
    /\b(?:add\s+to\s+(?:cart|basket|bag|trolley)|buy\s+now|in\s+(?:de\s+|het\s+)?winkel(?:wagen|mand)(?:je)?|toevoegen\s+aan|in\s+den\s+warenkorb|ajouter\s+au\s+panier|añadir\s+al\s+carrito|aggiungi\s+al\s+carrello|koop\s+nu|jetzt\s+kaufen)\b/i;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME']);

  // Sections showing other products ("You may also like", recently viewed, ...).
  // Their ABVs, ages and years belong to those bottles, so page text leaves them out.
  const OTHER_PRODUCTS_RE =
    /recommend|related|upsell|up-sell|cross-?sell|also-?like|also-?bought|recently-?viewed|frequently-?bought|bought-?together|more-?from/i;
  function isOtherProducts(node) {
    if (node === node.ownerDocument.body) return false;
    const cls = typeof node.className === 'string' ? node.className : '';
    return OTHER_PRODUCTS_RE.test(`${node.tagName} ${node.id} ${cls}`);
  }
  function inOtherProducts(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (isOtherProducts(n)) return true;
    return false;
  }
  const PRODUCT_TYPE_RE = /Product/i;
  const LISTING_TYPE_RE = /^(?:ItemList|CollectionPage|SearchResultsPage|OfferCatalog)$/i;

  // ---------------------------------------------------------------------------
  // Small helpers

  function clean(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  }

  function norm(s) {
    return clean(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019`´]/g, "'")
      .toLowerCase();
  }

  function num(s) {
    return parseFloat(String(s).replace(',', '.'));
  }

  // Text in a page's structured data, which some sites give HTML-encoded
  // ("Laphroaig &#39;Willem Dafoe&#39;" at Majestic).
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return String(s).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? m;
      const code = parseInt(dec || hex, dec ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    });
  }
  const ldText = (v) => clean(decodeEntities(v == null ? '' : v));

  function pickName(v) {
    if (!v) return '';
    if (Array.isArray(v)) return pickName(v[0]);
    if (typeof v === 'object') return ldText(v.name || v['@value'] || '');
    return ldText(v);
  }

  function hasType(obj, re) {
    const t = obj && typeof obj === 'object' ? obj['@type'] : null;
    return [].concat(t || []).some((x) => re.test(String(x)));
  }

  function meta(doc, key) {
    const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
    return el ? clean(el.getAttribute('content')) : '';
  }

  function textOf(el, limit = 20000) {
    if (!el) return '';
    const doc = el.ownerDocument || el;
    const parts = [];
    let length = 0;
    // Elements are visited too, so that rejecting a section of other products
    // skips everything inside it. Icon titles (<svg><title>Cask</title>) stay:
    // some shops label their fields with them.
    const walker = doc.createTreeWalker(el, 1 | 4 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode(node) {
        if (node.nodeType === 1) return isOtherProducts(node) ? 2 /* REJECT */ : 3 /* SKIP */;
        const p = node.parentElement;
        return p && !SKIP_TAGS.has(p.tagName.toUpperCase()) ? 1 /* ACCEPT */ : 2 /* REJECT */;
      },
    });
    while (length < limit && walker.nextNode()) {
      const t = walker.currentNode.nodeValue;
      if (t && t.trim()) {
        parts.push(t);
        length += t.length;
      }
    }
    return clean(parts.join(' ')).slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Attribute parsers (exported for testing)

  // Whisky is bottled at 40% or more, and hardly ever above 65%: a figure outside
  // that range is not taken as the ABV, wherever it is found (a rare bottle
  // stronger than that is still recognised by its other details).
  const ABV_MIN = 40;
  const ABV_MAX = 65;
  const abvInRange = (v) => v >= ABV_MIN && v <= ABV_MAX;

  const N = '(\\d{2}(?:[.,]\\d{1,2})?)';
  const ABV_STRICT_RES = [
    new RegExp(N + '\\s*%\\s*(?:vol\\b|abv\\b|alc\\b|alcohol)', 'i'),
    new RegExp(
      '(?:\\babv|\\balc(?:ohol)?\\.?|alcoholpercentage|alcoholgehalte|alkoholgehalt|\\balcool)' +
        '\\s*(?:content|percentage|gehalte|by\\s+vol(?:ume)?\\.?)?\\s*[:=-]?\\s*' + N + '\\s*%',
      'i'
    ),
  ];
  // A labelled figure without the percent sign ("ABV: 59.7", "Alcohol: 46"): the
  // label and the colon are needed, nothing may follow that makes it another
  // measure ("Alcohol: 70cl").
  ABV_STRICT_RES.push(
    new RegExp(
      '(?:\\babv|\\balc(?:ohol)?\\.?|alcoholpercentage|alcoholgehalte|alkoholgehalt|\\balcool)' +
        '\\s*(?:content|percentage|gehalte|by\\s+vol(?:ume)?\\.?)?\\s*:\\s*' + N + '(?![\\d.,%]|\\s*(?:°|proof\\b|(?:ml|cl|ltr|liter|litre|lt|l)(?![a-z])))',
      'i'
    )
  );
  // A bare percentage right next to a bottle size ("70cl | 45.8%", "45.8% 70cl") is the ABV.
  const VOL_TOKEN = '\\d+(?:[.,]\\d+)?\\s*(?:ml|cl|ltr|liter|litre|lt|l)(?![a-z])';
  const NEAR = '[\\s|/·•,–-]{1,6}';
  ABV_STRICT_RES.push(
    new RegExp(VOL_TOKEN + NEAR + N + '\\s*%', 'i'),
    new RegExp('(?:^|[^\\d.,])' + N + '\\s*%' + NEAR + VOL_TOKEN, 'i')
  );
  const ABV_LOOSE_RE = new RegExp('(?:^|[\\s(,/-])' + N + '\\s*%', 'i');
  // Fallback: a bare percentage in the ABV range is taken as the ABV, unless it
  // reads like a discount or a share ("48% of reviewers"). It starts at 41%: a
  // bare 40% is more often a discount than not.
  const FALLBACK_ABV_MIN = 41;
  const BARE_PERCENT_RE = /(?:^|[^\d.,])(\d{2}(?:[.,]\d{1,2})?)\s*%/g;
  const DISCOUNT_RE =
    /\b(?:off|korting|rabatt|discount|save|sale|uitverkoop|remise|descuento|sconto|up\s+to|tot|bis\s+zu|extra|cashback)\b|[-–]\s*$/i;

  function parseFallbackAbv(text) {
    if (!text) return null;
    for (const m of text.matchAll(BARE_PERCENT_RE)) {
      const v = num(m[1]);
      if (v < FALLBACK_ABV_MIN || !abvInRange(v)) continue;
      const start = m.index + m[0].indexOf(m[1]);
      const before = text.slice(Math.max(0, start - 10), start);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 15);
      if (DISCOUNT_RE.test(before) || /^\s*(?:off|of|korting|rabatt|discount|remise|descuento|sconto)\b/i.test(after)) continue;
      return v;
    }
    return null;
  }

  const PROOF_RE = /\b(\d{2,3}(?:\.\d)?)\s*(°\s*)?proof\b/i;
  // Old British bottles: "75° proof", or sizes in imperial fluid ounces ("26⅔ fl. oz").
  const UK_PROOF_HINT_RE = /\b(?:uk|british|imperial)\s+proof\b|\bfl\.?\s*ozs?\b|\b26\s*(?:⅔|2\/3)/i;

  /** ABV for a proof figure: UK proof is 4/7 of it (labels round 75° to 43%), US proof half. */
  function proofAbv(proof, uk) {
    if (!uk) return Math.round(proof * 5) / 10;
    const abv = (proof * 4) / 7;
    return Math.abs(abv - Math.round(abv)) <= 0.15 ? Math.round(abv) : Math.round(abv * 10) / 10;
  }

  /** ABV in percent. `loose` also accepts a bare "46%" (only safe on product names). */
  function parseAbv(text, loose) {
    if (!text) return null;
    const res = loose ? [...ABV_STRICT_RES, ABV_LOOSE_RE] : ABV_STRICT_RES;
    for (const re of res) {
      const m = text.match(re);
      if (m) {
        const v = num(m[1]);
        if (abvInRange(v)) return v;
      }
    }
    const p = text.match(PROOF_RE);
    if (p) {
      const v = num(p[1]);
      const abv = proofAbv(v, !!p[2] || UK_PROOF_HINT_RE.test(text));
      if (abvInRange(abv)) return abv;
    }
    return null;
  }

  const VOLUME_RE = /(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(ml|cl|ltr|liter|litre|lt|l)(?![a-z])/gi;
  const VOLUME_FACTOR = { ml: 1, cl: 10, l: 1000, lt: 1000, ltr: 1000, liter: 1000, litre: 1000 };

  // "26⅔ fl. oz" (UK, 75cl), "25.4 fl oz" (US, 750 ml): fluid ounces, imperial or US.
  const FL_OZ_RE = /\b(\d{1,2}(?:[.,]\d+)?)\s*(⅔|⅓|\s2\/3|\s1\/3)?\s*(?:fl\.?\s*ozs?\.?|fluid\s+ounces?)(?![a-z])/i;
  const OZ_ML = [28.413, 29.574];
  const BOTTLE_SIZES = [50, 100, 200, 350, 375, 500, 700, 750, 1000, 1125, 1500, 1750];

  /** A bottle size in fluid ounces, as the nearest common size in millilitres (within 3%). */
  function parseFluidOunces(text) {
    const m = text.match(FL_OZ_RE);
    if (!m) return null;
    const oz = num(m[1]) + (m[2] ? (/⅔|2\/3/.test(m[2]) ? 2 / 3 : 1 / 3) : 0);
    for (const factor of OZ_ML) {
      const size = BOTTLE_SIZES.find((ml) => Math.abs(oz * factor - ml) <= ml * 0.03);
      if (size) return size;
    }
    return null;
  }

  /** Bottle volume in millilitres. */
  function parseVolume(text) {
    if (!text) return null;
    for (const m of text.matchAll(VOLUME_RE)) {
      const ml = Math.round(num(m[1]) * VOLUME_FACTOR[m[2].toLowerCase()]);
      if (ml >= 20 && ml <= 4500) return ml;
    }
    return parseFluidOunces(text);
  }

  const STANDARD_VOLUMES = [500, 700, 1000];

  /** Like parseVolume, but only accepts the common bottle sizes 50cl, 70cl and 1l. */
  function parseStandardVolume(text) {
    if (!text) return null;
    for (const m of text.matchAll(VOLUME_RE)) {
      const ml = Math.round(num(m[1]) * VOLUME_FACTOR[m[2].toLowerCase()]);
      if (STANDARD_VOLUMES.includes(ml)) return ml;
    }
    return null;
  }

  const AGE_RE =
    /\b(\d{1,2})[\s-]*(?:years?|yrs?\.?|y\.?o\.?|jaar|jarige|jahre|j[äa]hrig|ans|a[ñn]os|anni)(?![a-z])(?:[\s-]*old)?/i;
  const AGE_LABEL_RE =
    /\b(?:age|alter|leeftijd|[âa]ge|edad)\s*[:-]\s*(\d{1,2})\b|\baged\s+(?:for\s+)?(\d{1,2})\s*(?:years?|yrs?\.?)(?![a-z])/i;

  /** Age statement in years. `labelled` only accepts "Age: 12" / "Aged 12 years" style (for spec tables). */
  function parseAge(text, labelled) {
    if (!text) return null;
    const m = text.match(labelled ? AGE_LABEL_RE : AGE_RE);
    if (!m) return null;
    const v = parseInt(m[1] || m[2], 10);
    return v >= 3 && v <= 80 ? v : null;
  }

  // A year, but not a decade ("the 1960s", "1960's").
  const YEAR = "((?:19|20)\\d{2})(?!'?s\\b)";
  const VINTAGE_RE = new RegExp(
    '\\b(?:vintage|distilled|dist\\.?|destilliert|gedestilleerd|distillation|jahrgang)\\s*[:-]?\\s*' + YEAR + '\\b',
    'i'
  );
  const BOTTLED_RE = new RegExp(
    '(?:\\bbottled|\\bbott\\.?|abgef[üu]llt|gebotteld|\\bbottling)\\s*(?:date|year|in)?\\s*[:-]?\\s*' + YEAR + '\\b',
    'i'
  );
  const YEAR_RANGE_RE = new RegExp('\\b' + YEAR + '\\s*[/-]\\s*' + YEAR + '\\b');

  // "Distilled at Inchgower in 2011", "Distilled on 15 Nov 2011", "bottled in 2026":
  // the keyword and a year in the same sentence, at most 40 characters apart.
  const SENTENCE_YEAR = '\\b([^!?\\n]{0,40}?)\\b' + YEAR + '\\b';
  const VINTAGE_SENTENCE_RE = new RegExp(
    '\\b(?:distilled|destilliert|gedestilleerd|distill[ée]|destilado)' + SENTENCE_YEAR,
    'gi'
  );
  const BOTTLED_SENTENCE_RE = new RegExp('\\b(?:bottled|abgef[üu]llt|gebotteld|embouteill[ée])' + SENTENCE_YEAR, 'gi');
  // Between keyword and year: no sentence break, and not a founding date.
  const NOT_BETWEEN_RE = /\.\s|\b(?:since|founded|established|est\.?|seit|sinds|depuis|built|opened)\b/i;

  function sentenceYear(text, re) {
    if (!text) return null;
    for (const m of text.matchAll(re)) {
      if (!NOT_BETWEEN_RE.test(m[1])) return +m[2];
    }
    return null;
  }

  // A year in a product name that is a release year rather than a vintage.
  const RELEASE_YEAR_RE = new RegExp(
    '\\b(?:release[d]?|edition|bottled|bottling|festival|special\\s+release)\\s*' + YEAR + '\\b|\\b' + YEAR +
      '\\s*(?:release|edition|bottling|festival)\\b',
    'i'
  );

  /** The only year in a product name ("Inchgower 14 Year Old 2011"), unless it reads as a release year. */
  function bareNameYear(name) {
    const years = (String(name).match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    if (new Set(years).size !== 1 || RELEASE_YEAR_RE.test(name)) return null;
    return years[0] <= new Date().getFullYear() ? years[0] : null;
  }

  /** A vintage must leave room for the age, and come before the bottling year. */
  function plausibleVintage(vintage, age, bottled) {
    if (!vintage) return false;
    if (age && vintage + age > new Date().getFullYear() + 1) return false;
    if (bottled && vintage > bottled) return false;
    return true;
  }

  /** { vintage, bottled } years, either may be null. */
  function parseYears(text) {
    const out = { vintage: null, bottled: null };
    if (!text) return out;
    const range = text.match(YEAR_RANGE_RE);
    if (range && +range[1] < +range[2]) {
      out.vintage = +range[1];
      out.bottled = +range[2];
    }
    const v = text.match(VINTAGE_RE);
    out.vintage = v ? +v[1] : out.vintage || sentenceYear(text, VINTAGE_SENTENCE_RE);
    const b = text.match(BOTTLED_RE);
    out.bottled = b ? +b[1] : out.bottled || sentenceYear(text, BOTTLED_SENTENCE_RE);
    return out;
  }

  /** { brand, distillery } for a known sub-brand in `text`, or null. */
  function matchSubBrand(text) {
    const n = norm(text);
    if (!n) return null;
    for (const { brand, distillery, re } of SUB_BRAND_RES) if (re.test(n)) return { brand, distillery };
    return null;
  }

  function matchDistillery(text) {
    const n = norm(text);
    if (!n) return null;
    for (const { name, re } of DISTILLERY_RES) if (re.test(n)) return name;
    return null;
  }

  const SMWS_RE = /scotch\s+malt\s+whisky\s+society|\bsmws\b/i;

  // The first SMWS code in a text with its distillery, from smws.js when it is
  // loaded too (as in the extension and the tests); this file needs nothing else.
  function smwsCodeIn(text) {
    const codes = root.SmwsCodes;
    return (codes && codes.findCodes(text)[0]) || null;
  }

  function matchBottler(text) {
    const n = norm(text);
    if (!n) return null;
    for (const { name, re } of BOTTLER_RES) if (re.test(n)) return name;
    return null;
  }

  /**
   * Interprets a "Bottler: ..." value. With `exact` (a table cell), an unknown
   * name is taken as the bottler; with free text only known names count.
   */
  function resolveBottlerValue(value, exact) {
    const v = clean(value);
    if (!v) return null;
    const b = matchBottler(v);
    if (b) return { bottler: exact && v.length <= 60 ? v : b, bottling: 'independent' };
    if (
      OFFICIAL_RE.test(v) ||
      /\b(?:distillery|official|original|distilleerderij|brennerei)\b/i.test(v) ||
      matchDistillery(v) ||
      OWNER_RE.test(v)
    ) {
      return { bottler: 'Distillery bottling', bottling: 'distillery' };
    }
    if (exact && v.length <= 60 && !NOT_A_BOTTLER_RE.test(v) && !CATEGORY_ONLY_RE.test(v)) {
      return { bottler: v, bottling: 'independent' };
    }
    return null;
  }

  /**
   * Works out who bottled the whisky. Returns { bottler, bottling, source }:
   * bottling is 'independent', 'distillery' or 'unknown'; source says where it
   * came from ('name', 'spec', 'brand', 'text') or 'assumed' when a distillery
   * was recognised but nothing named an independent bottler.
   */
  function isShopName(brand, siteName, url, title) {
    const b = norm(brand).replace(/[^a-z0-9]/g, '');
    if (!b) return false;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/[^a-z0-9]/g, '');
    } catch (e) {}
    const titleTail = clean(title).split(/\s+[|–—·•»-]\s+/).slice(1).join(' ');
    return [siteName, host, titleTail].some((x) => x && norm(x).replace(/[^a-z0-9]/g, '').includes(b));
  }

  function detectBottler({ nameText, rawName, brand, distillery, pairs, specText, description, siteName, url, title }) {
    const found = (r, source) => r && { ...r, source };

    if (OFFICIAL_RE.test(nameText) || OB_RE.test(rawName)) {
      return found({ bottler: 'Distillery bottling', bottling: 'distillery' }, 'name');
    }
    const inName = matchBottler(nameText);
    if (inName) {
      // Keep the page's own spelling when its brand names the same bottler.
      const bottler = brand && matchBottler(brand) === inName ? brand : inName;
      return found({ bottler, bottling: 'independent' }, 'name');
    }

    for (const [key, value] of pairs) {
      if (BOTTLER_KEY_RE.test(clean(key))) {
        const r = resolveBottlerValue(value, true);
        if (r) return found(r, 'spec');
      }
    }
    for (const [, value] of pairs) {
      if (clean(value).length <= 60 && matchBottler(value)) {
        return found({ bottler: clean(value), bottling: 'independent' }, 'spec');
      }
    }
    const text = `${specText}\n${description}`;
    const inline = text.match(BOTTLER_INLINE_RE);
    const r = inline && resolveBottlerValue(inline[1], false);
    if (r) return found(r, 'text');
    if (OFFICIAL_RE.test(text)) return found({ bottler: 'Distillery bottling', bottling: 'distillery' }, 'text');
    const inSpec = matchBottler(specText);
    if (inSpec) return found({ bottler: inSpec, bottling: 'independent' }, 'spec');

    if (brand && distillery) {
      if (matchDistillery(brand) || matchSubBrand(brand) || OWNER_RE.test(brand)) {
        return found({ bottler: 'Distillery bottling', bottling: 'distillery' }, 'brand');
      }
      // A brand that is not the distillery is usually the bottler, unless it is
      // just a category, a region or the shop itself.
      if (!CATEGORY_ONLY_RE.test(brand) && !NOT_A_BOTTLER_RE.test(brand) && !isShopName(brand, siteName, url, title)) {
        return found({ bottler: brand, bottling: 'independent' }, 'brand');
      }
    }
    for (const [key, value] of pairs) {
      if (COMPANY_KEY_RE.test(clean(key).replace(/:$/, ''))) {
        const r = resolveBottlerValue(value, true);
        if (r) return found(r, 'spec');
      }
    }
    // The site itself belongs to an independent bottler (e.g. the SMWS shop).
    if (matchBottler(siteName)) return found({ bottler: clean(siteName), bottling: 'independent' }, 'site');
    if (distillery) return found({ bottler: 'Distillery bottling', bottling: 'distillery' }, 'assumed');
    return { bottler: null, bottling: 'unknown', source: null };
  }

  function countWhiskyTerms(text) {
    return (text.match(new RegExp(WHISKY_SRC, 'gi')) || []).length;
  }

  // Auction headings that name the lot rather than the bottle: "Submit your bid for item #4838071", "Lot 123".
  const LOT_HEADING_RE = /^(?:(?:submit|place)\s+(?:your|a)\s+bid\s+(?:for|on)\s+)?(?:lot|item)\s*(?:no\.?|number)?\s*#?\s*\d+$/i;
  // A lot number in front of the name: "#4838071 - Port Ellen", "Lot 123: Port Ellen".
  const LOT_PREFIX_RE = /^(?:(?:lot|item)\s*(?:no\.?|number)?\s*#?|#)\s*\d+\s*[-–—:]\s*/i;

  // Size and strength at the end of a name, shown as fields of their own: "… 33 Year Old 70cl / 46.6%".
  const SIZE_ABV_SUFFIX_RE = /[\s,|–-]*\d+(?:[.,]\d+)?\s*(?:ml|cl|l)\s*[/|,]\s*\d{2}(?:[.,]\d{1,2})?\s*%(?:\s*vol\.?)?$/i;

  /** Strips the site name, a lot number and suffixes like " | Shop" or " - review" from a page title. */
  function cleanTitle(title, siteName) {
    let parts = clean(title)
      .split(/\s+[|–—·•»]\s+/)
      .map(clean)
      .filter(Boolean);
    if (siteName && parts.length > 1) {
      const site = norm(siteName);
      const kept = parts.filter((p) => norm(p) !== site);
      if (kept.length) parts = kept;
    }
    if (LOT_HEADING_RE.test(parts[0] || '')) return '';
    return (parts[0] || '').replace(LOT_PREFIX_RE, '').replace(/\s*[-:–—]\s*(?:review|tasting\s+notes?|recensie|proefnotities)\b.*$/i, '');
  }

  // ---------------------------------------------------------------------------
  // Signal collection

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      try {
        // Some sites put raw newlines/tabs inside JSON strings.
        return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
      } catch (e2) {
        return null;
      }
    }
  }

  function readJsonLd(doc) {
    const top = [];
    const flatten = (data) => {
      if (Array.isArray(data)) return data.forEach(flatten);
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data['@graph'])) data['@graph'].forEach(flatten);
      if (data['@type']) top.push(data);
    };
    for (const script of doc.querySelectorAll('script[type="application/ld+json" i]')) {
      flatten(parseJson(script.textContent));
    }

    const products = [];
    let listing = false;
    let breadcrumb = '';
    for (const item of top) {
      if (hasType(item, PRODUCT_TYPE_RE)) products.push(item);
      else if (hasType(item.mainEntity, PRODUCT_TYPE_RE)) products.push(item.mainEntity);
      else if (hasType(item.itemReviewed, PRODUCT_TYPE_RE)) products.push(item.itemReviewed);

      if (hasType(item, LISTING_TYPE_RE)) {
        const n = [].concat(item.itemListElement || (item.mainEntity && item.mainEntity.itemListElement) || []).length;
        if (n >= 3 || !hasType(item, /ItemList/i)) listing = true;
      }
      if (hasType(item, /BreadcrumbList/i) && !breadcrumb) {
        breadcrumb = [].concat(item.itemListElement || [])
          .map((el) => pickName(el) || pickName(el && el.item))
          .filter(Boolean)
          .join(' > ');
      }
    }
    if (products.length >= 3) listing = true;
    return { products: products.map(fromJsonLd), listing, breadcrumb };
  }

  function fromJsonLd(p) {
    const props = [].concat(p.additionalProperty || [])
      .filter((x) => x && typeof x === 'object')
      .map((x) => `${pickName(x)}: ${ldText(x.value)}${x.unitText ? ' ' + ldText(x.unitText) : ''}`);
    return {
      source: 'JSON-LD',
      name: pickName(p.name),
      brand: pickName(p.brand) || pickName(p.manufacturer),
      description: ldText(p.description).slice(0, 2000),
      category: [].concat(p.category || []).map(pickName).join(' > '),
      gtin: clean(p.gtin13 || p.gtin || p.gtin12 || p.gtin14 || p.gtin8 || p.ean),
      props: props.join('\n'),
    };
  }

  function ownerScope(el) {
    const start = el.hasAttribute('itemscope') ? el.parentElement : el;
    return start ? start.closest('[itemscope]') : null;
  }

  function microValue(el) {
    if (el.hasAttribute('itemscope')) {
      const own = [...el.querySelectorAll('[itemprop~="name"]')].find((c) => ownerScope(c) === el);
      return own ? microValue(own) : clean(el.textContent);
    }
    return clean(el.getAttribute('content') || el.getAttribute('value') || el.textContent);
  }

  function readMicrodata(doc) {
    const sel = '[itemscope][itemtype*="schema.org/Product" i]';
    const roots = [...doc.querySelectorAll(sel)].filter((el) => !(el.parentElement && el.parentElement.closest(sel)));
    const products = roots.map((el) => {
      const own = (name) => {
        const c = [...el.querySelectorAll(`[itemprop~="${name}"]`)].find((x) => ownerScope(x) === el);
        return c ? microValue(c) : '';
      };
      return {
        source: 'microdata',
        name: own('name'),
        brand: own('brand') || own('manufacturer'),
        description: own('description').slice(0, 2000),
        category: own('category'),
        gtin: own('gtin13') || own('gtin') || own('gtin12') || own('gtin8'),
        props: '',
      };
    });
    return { products, listing: roots.length >= 3 };
  }

  // The page's h1s, best first: the proper ones (outside header, menus and
  // footer, with text), then the rest. The first is the page's title; a page
  // may give it twice, one for phones and one for larger screens.
  function mainHeadingElements(doc) {
    const h1s = [...doc.querySelectorAll('h1')];
    const good = h1s.filter((h) => !h.closest('header, nav, footer') && clean(h.textContent).length >= 3);
    return [...good, ...h1s.filter((h) => !good.includes(h))];
  }

  function mainHeading(doc) {
    return clean((mainHeadingElements(doc)[0] || {}).textContent || '').slice(0, 300);
  }

  // A list of bottles without structured data says so by its layout: a grid of
  // cards, each a link round a photo. The largest set of distinct image links
  // whose cards (or a box up to six levels round them) are alike siblings.
  // Product pages have grids too (related bottles, a gallery), but smaller ones.
  const GRID_LISTING = 12;
  function productGrid(doc) {
    const groups = new Map(); // parent → card signature → hrefs
    let largest = 0;
    for (const img of doc.querySelectorAll('a[href] img')) {
      const a = img.closest('a');
      if (a.closest('header, nav, footer')) continue;
      const href = a.getAttribute('href').split(/[?#]/)[0];
      let card = a;
      for (let level = 0; level < 6 && card.parentElement && card.parentElement !== doc.body; level++) {
        const parent = card.parentElement;
        const sig = `${card.tagName} ${typeof card.className === 'string' ? card.className : ''}`;
        if (!groups.has(parent)) groups.set(parent, new Map());
        const bySig = groups.get(parent);
        if (!bySig.has(sig)) bySig.set(sig, new Set());
        const hrefs = bySig.get(sig).add(href);
        if (hrefs.size > largest && !inOtherProducts(parent)) largest = hrefs.size;
        card = parent;
      }
    }
    return largest;
  }

  function domBreadcrumb(doc) {
    const el = doc.querySelector(
      '[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], [itemtype*="BreadcrumbList" i]'
    );
    return el ? textOf(el, 400) : '';
  }

  function specText(doc) {
    const els = doc.querySelectorAll(
      'table, dl, [class*="spec" i], [class*="propert" i], [class*="attribute" i], [class*="detail" i], ' +
        '[class*="feature" i], [id*="spec" i], [id*="detail" i]'
    );
    const parts = [];
    let length = 0;
    for (const el of els) {
      if (length > 8000) break;
      if (el.closest('header, nav, footer') || inOtherProducts(el)) continue;
      const t = textOf(el, 3000);
      parts.push(t);
      length += t.length;
    }
    return parts.join('\n');
  }

  /**
   * [label, value] pairs from two-cell table rows, definition lists, and
   * "label" elements followed by their value (e.g. Drupal's
   * .field__label + .field__item).
   */
  function specPairs(doc) {
    const pairs = [];
    for (const tr of doc.querySelectorAll('tr')) {
      if (pairs.length >= 200) break;
      const cells = tr.querySelectorAll('th, td');
      if (cells.length === 2 && !inOtherProducts(tr)) pairs.push([textOf(cells[0], 100), textOf(cells[1], 200)]);
    }
    for (const dt of doc.querySelectorAll('dt')) {
      if (pairs.length >= 300) break;
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName.toUpperCase() === 'DD' && !inOtherProducts(dt)) pairs.push([textOf(dt, 100), textOf(dd, 200)]);
    }
    const labels = doc.querySelectorAll(
      '[class*="label" i], [class*="name" i], [class*="key" i], [class*="__type" i], [class*="__title" i]'
    );
    for (const label of labels) {
      if (pairs.length >= 400) break;
      const value = label.nextElementSibling;
      if (!value || label.closest('header, nav, footer') || inOtherProducts(label)) continue;
      // "label" classes are explicit; "name"/"key"/"type"/"title" only count when
      // followed by a "value" or "data" (e.g. .product-facts__type + .product-facts__data).
      const cls = (el) => el.getAttribute('class') || '';
      if (!/label/i.test(cls(label)) && !/value|__data\b/i.test(cls(value))) continue;
      const key = textOf(label, 100);
      // A value block with its own heading (name + description) is represented by the heading.
      const text = textOf(value.querySelector('h1, h2, h3, h4, h5, h6, .title') || value, 200);
      if (key && key.length <= 40 && text) pairs.push([key, text]);
    }
    return pairs;
  }

  /**
   * [label, value] pairs written inline: a bold or italic label ending in a colon,
   * then the value ("<li><strong>Bottler:</strong> Whisky-Doris</li>",
   * "<p><em>Alc. Content:</em> 43%</p>").
   */
  function inlinePairs(doc) {
    const pairs = [];
    for (const label of doc.querySelectorAll('li > strong, li > b, li > em, p > strong, p > b, p > em')) {
      if (pairs.length >= 100) break;
      const line = label.parentElement;
      if (line.firstChild !== label && clean(line.firstChild.textContent)) continue;
      const key = clean(label.textContent);
      if (!/^[^:]{2,40}:$/.test(key) || line.closest('header, nav, footer') || inOtherProducts(line)) continue;
      const value = clean(textOf(line, 300)).slice(key.length).trim();
      if (value && value.length <= 200) pairs.push([key.replace(/:$/, ''), value]);
    }
    return pairs;
  }

  /** First value of a pair whose label matches `keyRe`, run through `parse`. */
  function pairField(pairs, keyRe, parse = clean) {
    for (const [key, value] of pairs) {
      if (keyRe.test(clean(key).replace(/:$/, ''))) {
        const v = parse(value);
        if (v) return v;
      }
    }
    return null;
  }

  const BRAND_KEY_RE = /^(?:brand|merk|marke|marque|marca)$/i;
  const DISTILLERY_KEY_RE = /^(?:distillery|distilleerderij|brennerei|destillerie|distillerie|destiler[ií]a)$/i;
  const CATEGORY_KEY_RE =
    /^(?:spirit|type|category|categorie|kategorie|soort|style|(?:product|production|whisky|drink)\s+type)$/i;
  const AGE_KEY_RE = /^(?:age|alter|leeftijd|[âa]ge|edad)$/i;
  const VINTAGE_KEY_RE =
    /^(?:vintage|distilled(?:\s+(?:date|year|on|in))?|distillation(?:\s+(?:date|year))?|year\s+distilled|jahrgang|destilliert|destillatiejaar|gedestilleerd|mill[ée]sime)$/i;
  const BOTTLED_KEY_RE =
    /^(?:bottled(?:\s+(?:date|year|on|in))?|bottling(?:\s+(?:date|year))?|year\s+bottled|abf[üu]llung|abgef[üu]llt|gebotteld|bottelingsjaar)$/i;
  const CASK_NO_KEY_RE = /^(?:cask\s*(?:no\.?|number|nr\.?|#)|fass(?:nummer|\s*nr\.?)|vatnummer|vat\s*nr\.?)$/i;
  // A year on its own or inside a date ("2004", "16/02/2004", "Feb 2004").
  const yearOf = (v) => {
    const t = clean(v);
    const m = t.length <= 30 && t.match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
    return m ? +m[1] : null;
  };
  const ageOf = (v) => parseAge(v) || (/^\d{1,2}$/.test(clean(v)) ? parseAge(`${clean(v)} years`) : null);
  // "Cask no. 14148", "cask #106", and in a product name "(cask 803818)".
  const CASK_NO_RE =
    /\bcask\s*(?:no\.?|number|nr\.?|#)\s*:?\s*([A-Z]{0,2}\d{1,6}(?:[./-]\d{1,4})?)\b|\(\s*cask\s+([A-Z]{0,2}\d{1,6}(?:[./-]\d{1,4})?)\s*\)/i;
  const caskNoOf = (v) => {
    const m = clean(v).match(/^#?\s*([A-Z]{0,2}\d{1,6}(?:[./-]\d{1,4})?)\b/i);
    return m ? m[1] : null;
  };
  // A field labelled just "Cask" often holds the cask type, so only a value
  // that is nothing but a number counts ("8238", "#106").
  const CASK_KEY_RE = /^(?:cask|fass|vat)$/i;
  const caskOnlyOf = (v) => {
    const m = clean(v).match(/^#?\s*([A-Z]{0,2}\d{1,6}(?:[./-]\d{1,4})?)$/i);
    return m ? m[1] : null;
  };
  // "Cask 8238 is …" in running text: a number right after "cask", but not a
  // strength, age, size, bottle count or year.
  const CASK_PLAIN_RE =
    /\bcask\s+(?!(?:19|20)\d{2}\b)(\d{2,6})\b(?!\s*(?:%|years?\b|yo\b|y\.o\.|cl\b|ml\b|l\b|litres?\b|liters?\b|bottles?\b))/i;
  // "RMW Exclusive #8238" in a product name, but not a series number ("100 Proof Edition #78", "Batch #5").
  const NAME_HASH_RE = /(?<!\b(?:edition|batch|release|chapter|series|volume|vol\.?|no\.?)\s?)(?:^|\s)#\s?(\d{2,6})\b/i;

  function countCartButtons(doc) {
    let n = 0;
    for (const el of doc.querySelectorAll('button, input[type="submit"], input[type="button"], a')) {
      const label = el.tagName === 'INPUT' ? el.getAttribute('value') : el.textContent;
      if (label && label.length < 80 && CART_RE.test(label)) n++;
    }
    return n;
  }

  function collectSignals(doc, opts = {}) {
    const ld = readJsonLd(doc);
    const md = readMicrodata(doc);
    const siteName = meta(doc, 'og:site_name');
    const inline = inlinePairs(doc);
    const products = [...ld.products, ...md.products];
    const ogType = meta(doc, 'og:type').toLowerCase();
    // Only without the page's own product data, which settles what it shows.
    const grid = products.length || /product/.test(ogType) ? 0 : productGrid(doc);
    return {
      url: opts.url || (doc.location && doc.location.href) || '',
      title: clean(doc.title),
      siteName,
      ogType,
      ogTitle: meta(doc, 'og:title'),
      description: meta(doc, 'description') || meta(doc, 'og:description'),
      h1: mainHeading(doc),
      breadcrumb: ld.breadcrumb || domBreadcrumb(doc),
      products,
      listing: ld.listing || md.listing || grid >= GRID_LISTING,
      grid,
      cartButtons: countCartButtons(doc),
      // Inline pairs also count as spec text, for the ABV and size they hold.
      specText: [specText(doc), ...inline.map(([k, v]) => `${k}: ${v}`)].join('\n'),
      specPairs: [...specPairs(doc), ...inline],
      bodyText: textOf(doc.body, 30000),
    };
  }

  // ---------------------------------------------------------------------------
  // Scoring

  function evaluate(s) {
    const reasons = [];
    const add = (points, text) => {
      reasons.push({ points, text });
      return points;
    };

    const product = s.products.find((p) => p.name) || s.products[0] || null;
    const name =
      (product && product.name) || cleanTitle(s.h1) || cleanTitle(s.ogTitle, s.siteName) || cleanTitle(s.title, s.siteName);
    const brand = (product && product.brand) || pairField(s.specPairs, BRAND_KEY_RE) || '';
    const nameText = [...new Set([name, cleanTitle(s.h1), brand].filter(Boolean))].join(' · ');
    const description = [product && product.description, s.description].filter(Boolean).join(' ');
    const category = [product && product.category, s.breadcrumb, pairField(s.specPairs, CATEGORY_KEY_RE)]
      .filter(Boolean)
      .join(' > ');

    // Whisky context
    let context = 0;
    const nameHasWhisky = WHISKY_RE.test(nameText);
    const subBrand = matchSubBrand(nameText);
    const nameDistillery = matchDistillery(nameText) || (subBrand && subBrand.distillery);
    // Auction sites often have a generic heading ("Submit your bid for item #…")
    // and give the distillery only in a labelled "Distillery:" field.
    const specDistillery = nameDistillery ? null : pairField(s.specPairs, DISTILLERY_KEY_RE, matchDistillery);
    const bottlerInName = matchBottler(nameText);
    const siteBottler = matchBottler(s.siteName);
    // The Society's bottles give no distillery, only their code ("12.82" is
    // BenRiach's); their names say nothing ("Sponge cake on the wine lake").
    const smwsCode =
      nameDistillery || specDistillery || !SMWS_RE.test(`${bottlerInName} ${siteBottler}`)
        ? null
        : smwsCodeIn(`${nameText}\n${s.title}\n${s.ogTitle}\n${s.specText}`);
    const distillery = nameDistillery || specDistillery || (smwsCode && smwsCode.distillery);
    if (STRONG_WHISKY_RE.test(nameText)) context += add(3, 'Product name mentions whisky');
    else if (nameHasWhisky) context += add(2, 'Product name mentions bourbon/scotch');
    if (nameDistillery) {
      const via = subBrand && !matchDistillery(nameText) ? ` (via brand ${subBrand.brand})` : '';
      context += add(3, `Known distillery/brand in name: ${distillery}${via}`);
    } else if (specDistillery) {
      context += add(3, `Known distillery in product details: ${distillery}`);
    } else if (smwsCode) {
      context += add(3, `Distillery from the SMWS code ${smwsCode.code}: ${distillery}`);
    }
    if (bottlerInName && !distillery) context += add(3, `Known independent bottler in name: ${bottlerInName}`);
    if (siteBottler && !bottlerInName && !distillery) context += add(2, `Site of independent bottler: ${s.siteName}`);
    if (WHISKY_RE.test(category)) context += add(2, 'Breadcrumbs/category mention whisky');
    if (!nameHasWhisky && WHISKY_RE.test(`${s.title} ${s.ogTitle}`)) context += add(1, 'Page title mentions whisky');
    if (WHISKY_RE.test(description)) context += add(1, 'Description mentions whisky');
    if (countWhiskyTerms(s.bodyText) >= 5) context += add(1, 'Page text mentions whisky repeatedly');

    // Bottle evidence
    let bottle = 0;
    if (product && !s.listing) bottle += add(2, `Structured product data (${product.source})`);
    if (/product/.test(s.ogType)) bottle += add(1, `og:type is "${s.ogType}"`);
    if (s.cartButtons >= 1 && s.cartButtons <= 4) bottle += add(1, 'Add-to-cart button');

    const structuredText = product ? `${product.props}\n${product.description}` : '';
    const abv =
      parseAbv(nameText, true) || parseAbv(structuredText) || parseAbv(s.specText) || (s.listing ? null : parseAbv(s.bodyText));
    const fallbackAbv = (abv || s.listing) ? null : parseFallbackAbv(s.specText) || parseFallbackAbv(s.bodyText);
    const volumeMl =
      parseVolume(nameText) ||
      parseVolume(product ? product.props : '') ||
      parseVolume(`${s.title} ${s.ogTitle}`) ||
      parseVolume(s.specText);
    // Last resort: a standard bottle size anywhere on the page (e.g. next to an icon).
    const pageVolumeMl = (volumeMl || s.listing) ? null : parseStandardVolume(s.bodyText);
    const age =
      parseAge(nameText) ||
      pairField(s.specPairs, AGE_KEY_RE, ageOf) ||
      parseAge(structuredText, true) ||
      parseAge(s.specText, true);
    // Most explicit first: labelled fields, "cask no." in text, then "cask 8238", then "#8238" in the name.
    const pageText = `${nameText}\n${structuredText}\n${s.specText}\n${s.bodyText}`;
    const caskMatch = pageText.match(CASK_NO_RE);
    const caskNumber =
      pairField(s.specPairs, CASK_NO_KEY_RE, caskNoOf) ||
      pairField(s.specPairs, CASK_KEY_RE, caskOnlyOf) ||
      (caskMatch && (caskMatch[1] || caskMatch[2])) ||
      (pageText.match(CASK_PLAIN_RE) || [])[1] ||
      (name.match(NAME_HASH_RE) || [])[1] ||
      null;
    const nameYears = parseYears(nameText);
    const specYears = parseYears(`${structuredText}\n${s.specText}`);
    const bottled =
      nameYears.bottled ||
      pairField(s.specPairs, BOTTLED_KEY_RE, yearOf) ||
      specYears.bottled ||
      (s.listing ? null : sentenceYear(s.bodyText, BOTTLED_SENTENCE_RE));
    // Most reliable first; free-text candidates must also fit the age and bottling year.
    const vintage =
      nameYears.vintage ||
      pairField(s.specPairs, VINTAGE_KEY_RE, yearOf) ||
      [specYears.vintage, bareNameYear(name), s.listing ? null : sentenceYear(s.bodyText, VINTAGE_SENTENCE_RE)].find((y) =>
        plausibleVintage(y, age, bottled)
      ) ||
      null;

    if (abv) bottle += add(1.5, `ABV ${abv}%`);
    else if (fallbackAbv) bottle += add(0.5, `ABV ${fallbackAbv}% (bare percentage in the usual ABV range)`);
    if (volumeMl) bottle += add(1, `Volume ${volumeMl} ml`);
    else if (pageVolumeMl) bottle += add(0.5, `Volume ${pageVolumeMl} ml (standard size found in page text)`);
    if (age) bottle += add(1, `Age statement ${age} years`);
    if (vintage) bottle += add(0.5, `Vintage ${vintage}`);

    // Penalties
    let penalty = 0;
    if (s.listing) {
      const what = s.grid >= GRID_LISTING ? `a grid of ${s.grid} bottles` : 'several products';
      penalty += add(-4, `Looks like a listing/category page (${what})`);
    }
    else if (s.cartButtons > 6) penalty += add(-2, `Many add-to-cart buttons (${s.cartButtons})`);
    const otherSpirit = nameText.replace(CASK_DRINK_RE, ' ').match(OTHER_SPIRIT_RE);
    if (otherSpirit && !nameHasWhisky && !distillery) {
      penalty += add(-5, `Product name suggests another drink: "${otherSpirit[0]}"`);
    }

    const notBottle = nameText.match(NOT_A_BOTTLE_RE);
    if (notBottle) penalty += add(-4, `Product name suggests it is not a bottle: "${notBottle[0]}"`);

    const propPairs = (product ? product.props : '')
      .split('\n')
      .map((line) => line.split(/:\s(.*)/s))
      .filter((kv) => kv.length > 1);
    const bottler = detectBottler({
      nameText,
      rawName: name,
      brand,
      distillery,
      pairs: [...propPairs, ...s.specPairs],
      specText: s.specText,
      description: `${structuredText}\n${s.description}`,
      siteName: s.siteName,
      url: s.url,
      title: s.title,
    });

    // Brand is only worth showing when it adds something: a known sub-brand
    // (Port Charlotte at Bruichladdich), or a brand on a page where no
    // distillery was recognised. A brand that repeats the distillery or the
    // bottler, or is the shop or a category, is hidden.
    let displayBrand = '';
    if (subBrand) displayBrand = subBrand.brand;
    else if (
      brand &&
      !distillery &&
      !matchBottler(brand) &&
      norm(brand) !== norm(bottler.bottler || '') &&
      !CATEGORY_ONLY_RE.test(brand) &&
      !OWNER_RE.test(brand) &&
      !isShopName(brand, s.siteName, s.url, s.title)
    ) {
      displayBrand = brand;
    }

    const score = context + bottle + penalty;
    let status = 'none';
    if (!s.listing && context >= 3 && bottle >= 2 && score >= 6) status = 'whisky';
    else if (!s.listing && context >= 2 && bottle >= 1 && score >= 4) status = 'possible';

    return {
      version: VERSION,
      status,
      isWhisky: status === 'whisky',
      confidence: Math.max(0, Math.min(1, Math.round(score * 10) / 100)),
      score,
      url: s.url,
      whisky: {
        name: name.replace(SIZE_ABV_SUFFIX_RE, '') || name,
        brand: displayBrand,
        distillery,
        bottler: bottler.bottler,
        bottling: bottler.bottling,
        bottlerSource: bottler.source,
        age,
        abv: abv || fallbackAbv,
        volumeMl: volumeMl || pageVolumeMl,
        vintage,
        caskNumber,
        bottled,
        gtin: (product && product.gtin) || '',
      },
      reasons,
    };
  }

  function detect(doc, opts) {
    return evaluate(collectSignals(doc, opts));
  }

  const api = {
    VERSION,
    detect,
    collectSignals,
    evaluate,
    mainHeadingElements,
    parseAbv,
    parseFallbackAbv,
    parseVolume,
    parseStandardVolume,
    parseAge,
    parseYears,
    matchDistillery,
    matchBottler,
    matchSubBrand,
    detectBottler,
    cleanTitle,
  };
  root.WhiskyDetector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
