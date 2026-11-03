# Whiskybase Lookup (Chromium extension)

Recognises when the current web page shows a single bottle of whisky, pulls out
its details, and looks the bottle up on whiskybase.com.

## Load it in Chrome / Chromium

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Pin the extension (puzzle-piece icon → pin) so you can see its badge.

After you change the code, click the reload icon on the extension's card, then reload the page you're testing.

On any page, the toolbar icon shows:

| Badge | Meaning |
| ----- | ------- |
| green ✓ | whisky bottle detected |
| amber ? | possibly a whisky bottle |
| (none) | no whisky bottle |

Click the icon to see the extracted details (name, brand, distillery, bottler,
age, ABV, volume, vintage/bottled year, cask number, EAN) and, under
**Details of parsed data**, every signal that added or removed points. Each detection is also logged to the
page's DevTools console as `[Whiskybase Lookup]`.

To try it on the bundled test pages:

```bash
npm run serve-fixtures
```

Then open e.g. http://localhost:8000/shop-jsonld-ardbeg.html. (To use `file://`
pages instead, enable **Allow access to file URLs** on the extension's details page.)

## Whiskybase lookup

Whiskybase has no public API, so the extension uses Whiskybase's own search,
from the background worker with your browser's cookies.

- **When:** automatically for pages detected as a whisky bottle with at least 90%
  confidence. **Manual search** in the popup opens Whiskybase's own results page
  for the query in a new tab.
- **Query:** built from the detected fields (`buildQuery` in
  [`src/whiskybase.js`](src/whiskybase.js)), always with the ABV when known,
  because Whiskybase filters on it, and with the vintage year when known.
- **Results:** read from the data Whiskybase embeds in its results page, then
  scored against the detected bottle (`matchResults`: barcode, ABV, age, vintage,
  cask, size, distillery/brand, bottler, and name/series words; clear
  contradictions cost more than agreement earns). A **match** needs at least 6
  points and a lead of 3 over the runner-up; otherwise the popup lists the best
  candidates. **Details of Whiskybase match** shows the best result's points,
  why it was or wasn't accepted, the query, and the other candidates.
- **Match details:** the popup shows the parsed data on the left and Whiskybase
  on the right: the bottle photo, name, ID (as Whiskybase writes it, e.g.
  **WB233907**), and the rating with the number of reviews it is based on. The count is only on the bottle's own page, so
  a match costs one more request; the photo host is behind Cloudflare too, so the
  background fetches the photo (trying its other sizes if one fails) and hands
  it to the popup as data. When there is no photo, **Details of Whiskybase match**
  says why.
- **Badge:** **WB** (blue) when a match is found.
- **Politeness:** results are cached per query for an hour, requests are at least
  2 seconds apart and one at a time, and after a Cloudflare check automatic
  searches pause for 2 minutes. When the popup says **Blocked by the Cloudflare
  check**, open the search, pass the check yourself, and search again.

## How detection works

[`src/detector.js`](src/detector.js) gives points for signals and records each one:

- **Whisky context**: whisky words or one of ~185 known distilleries/brands/bottlers
  in the product name; whisky in breadcrumbs, title or description.
- **Bottle evidence**: schema.org `Product` data (JSON-LD or microdata),
  `og:type=product`, an add-to-cart button, and bottle attributes parsed from
  the name, structured data and spec tables: ABV (incl. US proof), volume (ml/cl/l),
  age statement (EN/NL/DE/FR/ES/IT), vintage and bottling year.
- **Penalties**: listing/category pages, other drinks (gin, rum, cognac, ...),
  non-bottle products (lotion, glasses, books, ...).

**Brand** is only shown when it adds something: a name a distillery sells under
(Port Charlotte and Octomore at Bruichladdich, Longrow at Springbank, Ledaig at Tobermory,
Redbreast at Midleton, Blanton's at Buffalo Trace, ...), in which case **Distillery** shows
the actual distillery; or the page's brand when no distillery was recognised. A brand that
repeats the distillery or bottler, or is the shop's name or a category, is hidden.

**Bottler** is worked out in this order: an official-bottling phrase or "OB" in the name;
a known independent bottler (~50, including series names such as *Connoisseurs Choice*)
in the name or brand; a *Bottler / Bottled by / Abfüller / Bottelaar* field in a spec
table (any name there counts); such a phrase in the description; the structured brand
(the distillery or its owner means a distillery bottling, anything else except the shop
itself or a category is taken as the bottler); a "Company" field; and finally the site
itself when it belongs to a known bottler (e.g. the SMWS shop). If only the distillery is
known, it is taken to be a distillery bottling. The popup only shows a Bottler row for
an independent bottler; for a distillery bottling or an unknown bottler it is left out.

A page counts as **whisky** with at least 3 context points, 2 bottle points and
6 points in total, and as **possible** with at least 2, 1 and 4. Listing pages never count.

## Files

| Path | Role |
| ---- | ---- |
| `manifest.json` | Manifest V3; `storage` permission and access to *.whiskybase.com |
| `src/detector.js` | Detection and extraction, no dependencies (also used by the tests) |
| `src/content.js` | Runs the detector on each page; re-scans single-page-app navigations and late-rendered content |
| `src/background.js` | Per-tab badge and tooltip; automatic Whiskybase lookup |
| `src/whiskybase.js` | Whiskybase query, results parsing and matching (no DOM; also used by the tests) |
| `popup/` | Toolbar popup with results and a Re-scan button |
| `test/` | Parser unit tests and fixture pages |

## Tests

```bash
npm test
```

Parser tests run in Node; the fixture pages in `test/fixtures/` run through the
detector in headless Chromium/Chrome (set `CHROME_BIN` if it isn't on your
PATH). Add `-v` (`node test/run.mjs -v`) to see every signal for each fixture.
To fix a page that is detected wrongly, save it as a fixture, add an expectation
in `test/run.mjs`, and adjust the detector.

Pages saved while signed in contain your name, email, username, account IDs and
session tokens. Scrub them before sharing the project; your own details are
passed as options, so they are never stored in it:

```bash
python3 test/scrub-fixture.py --name "First Last" --email you@example.org --username yourname --id 12345 test/fixtures/whiskybase/new-page.html
```
