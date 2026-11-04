# Development documentation

This file describes how the extension works, and how the code is structured. 

## A few notes when you're changing the code

After you change the code, click the reload icon on the extension's card, then reload the page you're testing. Each detection is also logged to the
page's DevTools console as `[Bottle lookup for Whiskybase]`.

## How parsing and detection works

[`src/detector.js`](src/detector.js) gives points for signals and records each one:

- **Whisky context**: whisky words or one of ~185 known distilleries/brands/bottlers
  in the product name; whisky in breadcrumbs, title or description.
- **Bottle evidence**: schema.org `Product` data (JSON-LD or microdata),
  `og:type=product`, an add-to-cart button, and bottle attributes parsed from
  the name, structured data and spec tables: ABV (incl. US proof), volume (ml/cl/l),
  age statement (EN/NL/DE/FR/ES/IT), vintage and bottling year. Sections showing
  other bottles ("You may also like", related or recently viewed products) are
  left out, so their ABVs, ages and cask numbers aren't mistaken for this bottle's.
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


## When pages are checked

The manifest has no content scripts, so the extension can't read pages unless asked:

- **On click (default):** clicking the toolbar icon gives the extension access to
  that tab (`activeTab`). If the page doesn't have the detector yet, the popup
  loads `src/detector.js` and `src/content.js` into it with `chrome.scripting`.
  From there it works as before: the content script reports to the background,
  which sets the badge and starts the Whiskybase lookup.
- **Automatic checking (opt-in):** the popup's **Check every page automatically**
  requests the optional access to all `http`/`https` sites and sets `autoCheck`
  in `chrome.storage.local`. While both hold, the background registers the same
  two files as a content script on every page (`syncAutoCheck`). Pages already
  open are checked on the next load or click.
- **Turning it off** only clears `autoCheck` and keeps the access. Withdrawing
  the access to all sites with `chrome.permissions.remove` also removes the
  Whiskybase hosts, although they are required in the manifest, and Chrome only
  gives those back on a new click and prompt. The access can be withdrawn in
  Chrome's own settings for the extension (**Site access**).
- **Without Whiskybase access** (after that, for example), the background
  doesn't search (`noaccess`) and the popup offers **Allow access to Whiskybase**.

A page can get the content script both ways; `content.js` then keeps one copy.

## How Whiskybase lookup works

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
  on the right: the bottle photo and name (followed by its bottling series in
  brackets, when Whiskybase has one), then rows for the ID (as Whiskybase
  writes it, e.g. **WB233907**), the rating with the number of reviews it is
  based on, and, when shops list the bottle, the price estimate (Whiskybase's
  Average Shop Price) with the number of shops. The review count, series and price are
  only on the bottle's own page, so a match costs one more request; the photo host is behind Cloudflare too, so the
  background fetches the photo (trying its other sizes if one fails) and hands
  it to the popup as data. When there is no photo, **Details of Whiskybase match**
  says why.
- **Badge:** **WB** (blue) when a match is found.
- **Politeness:** results are cached per query for an hour, requests are at least
  2 seconds apart and one at a time, and after a Cloudflare check automatic
  searches pause for 2 minutes. When the popup says **Blocked by the Cloudflare
  check** or **Paused after a Cloudflare check**, open the search, pass the
  check yourself, and click **Try again** (which also ends the pause).



## Files

| Path | Role |
| ---- | ---- |
| `manifest.json` | Manifest V3; `storage`, `activeTab` and `scripting` permissions, access to www.whiskybase.com (pages) and static.whiskybase.com (photos), and optional access to all sites (for automatic checking) |
| `src/detector.js` | Detection and extraction, no dependencies (also used by the tests) |
| `src/content.js` | Runs the detector on the page; re-scans single-page-app navigations and late-rendered content |
| `src/background.js` | Per-tab badge and tooltip; automatic Whiskybase lookup; registers the content script while automatic checking is on |
| `src/whiskybase.js` | Whiskybase query, results parsing and matching (no DOM; also used by the tests) |
| `popup/` | Toolbar popup with results, a Re-scan button and the automatic-checking setting; loads the detector into the tab when needed |
| `test/` | Parser unit tests and fixture pages |

## Packaging

```bash
npm run package
```

builds `dist/whiskybase-chromium-browser-extension/` and
`dist/whiskybase-chromium-browser-extension-<version>.zip`,
containing only what the extension needs (manifest, `src/`, `popup/`, PNG icons).

The GitHub Actions workflow [`.github/workflows/package.yml`](.github/workflows/package.yml)
runs only when started by hand: on GitHub, open **Actions**, pick **Package
extension** and click **Run workflow**. It runs the tests and this packaging,
and uploads the extension as a workflow artifact (on the run's summary page;
needs a GitHub login, kept for 90 days).

To publish a release that anyone can download, bump `version` in
`manifest.json`, commit, and push a matching tag:

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

Then run the workflow with that tag selected under **Use workflow from**. It
attaches the zip to a GitHub Release for the tag, and fails if the tag doesn't
match the manifest version.

The release notes are the install instructions in
[`.github/release-intro.md`](.github/release-intro.md) (`{version}` is filled
in), followed by the section for the version in [`CHANGELOG.md`](CHANGELOG.md),
if it has one: from a `## 0.2.1` heading (`## v0.2.1` or `## [0.2.1] - date`
work too) to the next `## `. Add that section before tagging. To preview the
notes:

```bash
node scripts/release-notes.mjs 0.2.1
```

## Tests


To try it on the bundled test pages:

```bash
npm run serve-fixtures
```

Then open e.g. http://localhost:8000/shop-jsonld-ardbeg.html and click the
extension's icon. (To use `file://` pages instead, enable **Allow access to file
URLs** on the extension's details page.)



```bash
npm test
```

Parser tests run in Node; the fixture pages in `test/fixtures/` run through the
detector in headless Chromium/Chrome (set `CHROME_BIN` if it isn't on your
PATH). Add `-v` (`node test/run.mjs -v`) to see every signal for each fixture.
To fix a page that is detected wrongly, save it as a fixture, add an expectation
in `test/run.mjs`, and adjust the detector.

The GitHub Actions workflow [`.github/workflows/test.yml`](.github/workflows/test.yml)
runs the tests on every push to any branch and on every pull request.

Pages saved while signed in contain your name, email, username, account IDs and
session tokens. Scrub them before sharing the project; your own details are
passed as options, so they are never stored in it:

```bash
python3 test/scrub-fixture.py --name "First Last" --email you@example.org --username yourname --id 12345 test/fixtures/whiskybase/new-page.html
```
