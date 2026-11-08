/*
 * The Scotch Malt Whisky Society's bottle codes ("3.369": the 369th cask the
 * Society bottled from distillery 3, Bowmore). The labels give only the code;
 * the distillery behind each number is not published by the Society but is
 * well known. On smws.com, the content script adds the distillery's name after
 * each code on the page.
 *
 * Only codes that published lists agree on are included (Whiskipedia, Whisky
 * Saga, Whisky Boys, scotchmaltwhisky.co.uk, checked November 2026), and 164;
 * a newer code is left as it is. Whisky only: the Society's rum, armagnac, cognac and
 * gin codes are left out.
 */
(function (root) {
  'use strict';

  const MALT = [
    'Glenfarclas', 'Glenlivet', 'Bowmore', 'Highland Park', 'Auchentoshan', // 1
    'Macduff', 'Longmorn', 'Tamdhu', 'Glen Grant', 'Bunnahabhain', // 6
    'Tomatin', 'BenRiach', 'Dalmore', 'Talisker', 'Glenfiddich', // 11
    'Glenturret', 'Scapa', 'Inchgower', 'Glen Garioch', 'Inverleven', // 16
    'Glenglassaugh', 'Glenkinchie', 'Bruichladdich', 'Macallan', 'Rosebank', // 21
    'Clynelish', 'Springbank', 'Tullibardine', 'Laphroaig', 'Glenrothes', // 26
    'Isle of Jura', 'Edradour', 'Ardbeg', 'Tamnavulin', 'Glen Moray', // 31
    'Benrinnes', 'Cragganmore', 'Caperdonich', 'Linkwood', 'Balvenie', // 36
    'Dailuaine', 'Tobermory', 'Port Ellen', 'Craigellachie', 'Dallas Dhu', // 41
    'Glenlossie', 'Benromach', 'Balmenach', 'St. Magdalene', 'Bladnoch', // 46
    'Bushmills', 'Old Pulteney', 'Caol Ila', 'Aberlour', 'Royal Brackla', // 51
    'Coleburn', 'Glen Mhor', 'Strathisla', 'Teaninich', 'Aberfeldy', // 56
    'Brora', 'Glenlochy', 'Glentauchers', 'Mannochmore', 'Imperial', // 61
    'Ardmore', 'Banff', 'Blair Athol', 'Glen Albyn', 'Balblair', // 66
    'Glenburgie', 'Miltonduff', 'Aultmore', 'North Port', 'Glenury Royal', // 71
    'Mortlach', 'Glen Ord', 'Ben Nevis', 'Deanston', 'Glen Spey', // 76
    'Glen Keith', 'Glencadam', 'Convalmore', 'Glendullan', 'Glen Elgin', // 81
    'Glenesk', 'Millburn', 'Speyburn', 'Tomintoul', 'Pittyvaich', // 86
    'Dufftown', 'Lochside', 'Glen Scotia', 'Fettercairn', 'Auchroisk', // 91
    'GlenDronach', 'Littlemill', 'Inverleven (Lomond still)', 'Glenugie', 'Strathmill', // 96
    'Knockando', 'Dalwhinnie', 'Royal Lochnagar', 'Glenburgie (Glencraig)', 'Tormore', // 101
    'Cardhu', 'Glenallachie', 'Allt-a-Bhainne', 'Miltonduff (Mosstowie)', 'Oban', // 106
    'Lagavulin', 'Loch Lomond (Inchmurrin)', 'Braeval', 'Springbank (Longrow)', 'Knockdhu (anCnoc)', // 111
    'Yoichi', 'Cooley (unpeated)', 'Cooley (peated)', 'Yamazaki', 'Hakushu', // 116
    'Isle of Arran', 'Loch Lomond (Croftengea)', 'Glengoyne', 'Miyagikyo', 'Glenmorangie', // 121
    'Springbank (Hazelburn)', 'Bruichladdich (Port Charlotte)', 'Penderyn', 'Kilchoman', 'Chichibu', // 126
    'Hanyu', 'Karuizawa', 'Westland', 'Paul John', 'Loch Lomond (Inchmoan)', // 131
    'Eden Mill', 'The English Whisky Co.', 'Nantou', 'Kavalan', 'Balcones', // 136
    'Fary Lochan', 'Breuckelen', 'Copperworks', 'High Coast', 'Smögen', // 141
    'Cotswolds', 'Archie Rose', 'Starward', 'Ardnamurchan', 'West Cork', // 146
    'Mackmyra', 'Shelter Point', 'Thy', 'Mosgaard', 'Milk & Honey', // 151
    'Glasgow', 'Armorik', 'Yuza', 'Mars Shinshu', 'Tsunuki', // 156
    "Nc'nean", 'Isle of Raasay', 'Isle of Harris', 'Penderyn', // 161 (164: double-distilled Penderyn)
  ];
  const OTHER = {
    G: [
      'North British', 'Carsebridge', 'Caledonian', 'Cameronbridge', 'Invergordon', 'Port Dundas', 'Girvan', 'Cambus',
      'Loch Lomond (grain)', 'Strathclyde', 'Nikka Coffey Grain', 'Nikka Coffey Malt', 'Chita', 'Dumbarton',
      'Loch Lomond (Rhosdhu)', 'Glasgow (grain)',
    ],
    B: ['Heaven Hill', 'Bernheim', 'Rock Town', 'FEW Spirits', 'George Dickel'],
    RW: ['FEW Spirits', 'Finger Lakes Distilling', 'New York Distilling Co.'],
    CW: ['Heaven Hill', 'Balcones'],
  };

  /** The distillery for a code's first part ("3", "G4", "RW1"), or null. */
  function distillery(prefix) {
    const m = /^(G|B|RW|CW)?(\d{1,3})$/i.exec(prefix);
    if (!m) return null;
    const list = m[1] ? OTHER[m[1].toUpperCase()] : MALT;
    return list[+m[2] - 1] || null;
  }

  // "3.369", "G4.21": not part of a longer number or word, a price ("£3.50",
  // "75.00": a cask number never starts with 0), a percentage ("58.6%"), a size
  // ("1.5 l") or an age ("12.5 years").
  const CODE_RE =
    /(?<![\w.,£$€])((?:G|B|RW|CW)?\d{1,3})\.([1-9]\d{0,3})(?![\w.,]?\d|\w|\s?(?:%|cl\b|ml\b|l\b|litres?\b|liters?\b|kg\b|g\b|years?\b|yo\b))/g;

  /** The known codes in a text, as { index, end, code, distillery }. */
  function findCodes(text) {
    const found = [];
    for (const m of text.matchAll(CODE_RE)) {
      const name = distillery(m[1]);
      if (name) found.push({ index: m.index, end: m.index + m[0].length, code: m[0], distillery: name });
    }
    return found;
  }

  /** Whether the page is the Society's own site, the only place codes are annotated. */
  function isSmwsSite(hostname) {
    return /(?:^|\.)smws\.com$/i.test(hostname);
  }

  const api = { distillery, findCodes, isSmwsSite };
  root.SmwsCodes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
