# Development documentation

This file describes how the extension works, and how the code is structured.
Coding agents (and anyone new to the code) also have [`AGENTS.md`](AGENTS.md):
the project's rules, how to check a change, and the usual pitfalls.

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
  non-bottle products (lotion, glasses, books, ...). A listing is recognised by
  its structured data (several products, an item list) or, on a page without
  product data, by a grid of at least 12 linked photos in alike cards.

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
**Details of parsed data** in the popup lists the points, and ends with whether
the page was accepted as a whisky bottle and its score.


## When pages are checked

The manifest has no content scripts, so the extension can't read pages unless asked:

- **On click (default):** clicking the toolbar icon gives the extension access to
  that tab (`activeTab`). If the page doesn't have the detector yet, the popup
  loads `src/detector.js`, `src/smws.js` and `src/content.js` into it with `chrome.scripting`.
  From there it works as before: the content script reports to the background,
  which sets the badge and starts the Whiskybase lookup.
  The lookup starts by itself only for a detection with at least 90% confidence
  (`AUTO_MIN_CONFIDENCE`); for others the popup offers **Find this bottle on
  Whiskybase**, which sends `whisky:lookup` to start the same lookup.
- **Automatic checking (opt-in):** the popup's **Check every page automatically**
  requests the optional access to all `http`/`https` sites and sets `autoCheck`
  in `chrome.storage.local`. While both hold, the background registers the same
  files as a content script on every page (`syncAutoCheck`). Pages already
  open are checked on the next load or click.
- **Whiskybase itself** is never scanned: the automatic content script excludes
  `whiskybase.com` and its subdomains (`Whiskybase.OWN_PAGES`), `content.js`
  stops at once there, the background ignores detections from there, and the
  popup only says the page is Whiskybase (`Whiskybase.isWhiskybasePage`). This
  also keeps the extension's own search and helper tabs from being scanned.
- **Turning it off** only clears `autoCheck` and keeps the access. Withdrawing
  the access to all sites with `chrome.permissions.remove` also removes the
  Whiskybase hosts, although they are required in the manifest, and Chrome only
  gives those back on a new click and prompt. The access can be withdrawn in
  Chrome's own settings for the extension (**Site access**).
- **Without Whiskybase access** (after that, for example), the background
  doesn't search (`noaccess`) and the popup offers **Allow access to Whiskybase**.

A page can get the content script both ways; `content.js` then keeps one copy.

On smws.com (and only there, against false positives), `content.js` also adds
the distillery's name after each of the Society's bottle codes: "3.369" becomes
"3.369 (Bowmore)". The codes and distilleries are in `src/smws.js`, which only
has codes that published lists agree on; a newer code is left as it is. The
name sits in a shadow root, so the detector doesn't read it as the page's text.
Content added later (the Society's lists of bottles load after the page) is
annotated as well. Like everything else, this only happens where the content
script runs: after a click on the icon, or on every page with automatic
checking on.

## How Whiskybase lookup works

- **Query:** built from the detected fields (`buildQuery` in
  [`src/whiskybase.js`](src/whiskybase.js)), always with the ABV when known,
  because Whiskybase filters on it, and with the vintage year when known.
- **Results:** read from the data Whiskybase embeds in its results page, then
  scored against the detected bottle (`matchResults`: barcode, ABV, age, vintage,
  cask, size, distillery/brand, bottler, and name/series words; clear
  contradictions cost more than agreement earns). A **match** needs at least 6
  points and a lead of 3 over the runner-up; otherwise the popup lists the best
  candidates. **Details of Whiskybase match** shows the query (with the number
  of results, linking to the search), the best result's points, why it was or
  wasn't accepted, and the other candidates.
- **Match details:** the popup shows the parsed data on the left and Whiskybase
  on the right: the bottle photo and name (followed by its bottling series in
  brackets, when Whiskybase has one), then rows for the ID (as Whiskybase
  writes it, e.g. **WB233907**), the rating with the number of reviews it is
  based on, and, when shops list the bottle, the price estimate (Whiskybase's
  Average Shop Price) with the number of shops. The review count, series and price are
  only on the bottle's own page, which is fetched only when the popup shows the
  match (not for every page with one, to keep requests down); the photo host applies rate limiting and other checks too, so the
  background fetches the photo (trying its other sizes if one fails) and hands
  it to the popup as data. Until the bottle page is in, the photo's 220px and the
  price row are kept free, each with a spinner. When there is no photo, a generic
  bottle picture takes its place, and **Details of Whiskybase match** says why;
  without a price, the row says N/A.
- **Badge:** **WB** (blue) when a match is found.
- **Politeness:** results are cached per query for an hour, and requests are at
  least 3 seconds apart and one at a time.

### Rate limiting and other checks

Now and then, the background's requests to Whiskybase fail, for instance on a
check that only a person in a browser tab can pass.

- **Pause:** after a check, the background sends no requests of its own for
  2 minutes. **Try again** in the popup ends the pause.
- **Search on Whiskybase:** while a lookup is blocked, the popup says **Whiskybase
  wants a quick check first** and offers this button. It offers it after any other
  failed search too (with **Search failed** and the reason), since the search may
  still work in a tab of its own. It opens the search in a new
  tab, where the user passes the check if one shows up; meanwhile the lookup is
  **waiting**. When the tab has loaded the results, the background reads them from
  it (fetching the page again from inside the tab, since the rendered page no
  longer has the embedded results data), matches them for the original tab and
  caches the search. Closing the tab, or searching for something else in it, before
  then puts the lookup back to how it failed.
- **Helper tab:** that tab then becomes the helper tab. While it stays open on
  www.whiskybase.com (on any page), requests are done from inside it
  instead, as the Whiskybase page itself would. Nothing in the tab changes. That
  covers searches and bottle pages, but not photos, which are on another host.
  Once the background's own requests go through again, the tab isn't used. When
  it's closed or leaves Whiskybase, it stops being a helper tab. No other
  Whiskybase tab is ever used, and **Search on Whiskybase** always opens a new tab,
  which then becomes the helper tab.
- **Failed tabs catch up:** a tab whose search failed before there was a helper
  tab (one of several bottles opened in background tabs, say) searches again
  when the user switches to it, if there is a helper tab by then. It asks the
  tab's content script what the bottle is, and the search goes through the
  helper tab if the background's own request fails again.

#### Simulating search failures

To see the blocked state without being blocked, open the extension's service
worker console (`chrome://extensions` → Developer mode → **service worker** under
the extension) and run:

```js
chrome.storage.local.set({ debugSimulateSearchFailure: true })
```

Every Whiskybase page request from the background then acts as if it
failed, without being sent, and the cache is skipped. **Search on Whiskybase**
and the helper tab still work for real, since they don't use the background's
requests, so with a helper tab open every search goes through it. Photos are not
affected. The popup shows a small orange debug line while the flag is on, so you
don't forget. Turn it off with:

```js
chrome.storage.local.set({ debugSimulateSearchFailure: false })
```

There is no setting for it in the popup, so users never see it.

#### Simulating slow data loads

To see the popup while the bottle details (photo, price, review count, series)
are still loading, run this in the same console:

```js
chrome.storage.local.set({ debugSimulateSlowDataLoads: true })
```

The background then waits 5 seconds before fetching the bottle page, so the
spinners stay up long enough to look at. The details are kept with the match
once loaded, so to see it again, open a page with another bottle (or the same
page in a new tab). The popup shows its own orange debug line while the flag is
on. Turn it off with:

```js
chrome.storage.local.set({ debugSimulateSlowDataLoads: false })
```



## Bottles matched before, on lists of bottles

When a lookup finds a match, the background also stores it under the page's
address, as `known:<key>` in local storage with the Whiskybase ID, address,
name and rating, and the number of ratings once the bottle page is in (which also
updates the rating). The key, from
[`src/known-pages.js`](src/known-pages.js), leaves out the scheme, `www.`, a
trailing slash, the `#fragment` and tracking parameters (`utm_…`, `gclid` and
the like), and sorts the other parameters, so that a list's link to the page
gets the same key as the page itself. A later lookup on the page without a
match removes it.

Lists don't always link to the page that was matched: Whisky Auctioneer's
lists link each photo to the bottle (`/learn/explore-whisky/bottles/<name>?v=<lot>`)
rather than to the lot page (`/whisky-lot/<lot>/<name>`). So the match is
also stored under the address the page names as canonical (`<link
rel="canonical">`, which `content.js` adds to its detection result), as
`known:<key>#canonical`, also when it is the page's own address; not when
that is a home page, which some sites give as every page's canonical address.
A link on a list tries its own key first, then `<key>#canonical`, then, if it
has a query, that key without the query (`KnownPages.linkKeys`): the lot
page's canonical address is the bottle without `?v=`, so every lot of that
bottle on the list gets the badge. Likewise, Master of Malt's lists link to
`<product>/?sku=<n>`, and the product page names `<product>/` as canonical
however it was opened. Which parameters can be left out is the site's say
(its canonical address), never the extension's: where a parameter picks the
bottle (`product.php?id=123`), the canonical address keeps it.

On every page it runs on, `content.js` collects the links that show an image
and asks the background (`whisky:known`) which of them point to such a page;
links to the page's own address or its canonical address are left out. Each of those images gets a small badge on
the bottom of the photo, centred: the extension's icon and the rating, with a tooltip such
as "WB233907: Inchgower Madeira Finish MM (78 ratings)". The badge is in a shadow root, so the page's styles don't
reach it and the detector doesn't read it. It's tied to its image with CSS
anchor positioning, so it stays on the image when the page's layout shifts
afterwards (older browsers measure the image instead, on load and on resize).
Links added later (more results,
infinite scrolling) are picked up after a second, counted from the first
change: a page that keeps changing (Whisky Auction's clock rewrites its text
every 200ms) would otherwise never be checked again. Changes to text alone
don't count for this, as new links come as elements. When a match is stored or
updated in another tab (a bottle opened from the list in a background tab,
say), every page with the content script updates its badges straight away,
through `chrome.storage.onChanged`.
**Nothing is looked up for this**: it only uses what is stored, so no request
goes to Whiskybase.

Clicking a badge opens the popup on that bottle instead of following the link:
the background stores it as `shown:<tabId>` in session storage and calls
`chrome.action.openPopup()` (Chrome 127 and later). A popup opened within ten
seconds of that shows the bottle's card rather than the page's own data, and
asks for its details (photo, price) as it does for a lookup, which is the only
time Whiskybase is asked anything for a badge. Re-scan goes back to the page.

A bottle's own page gets the same badge once its bottle is matched
(`whisky:own-known`, the match stored under the page's address): on the
bottle's photo, taken to be the largest image on the page that is shown, at
least 120px each way and not a wide banner, outside the header, menus and
footer. Images are compared by their size in the layout, so a transform
doesn't count, and the badge stays on its photo unless another is larger: a
zoom on hover (Master of Malt) adds an enlarged copy of the photo, which stays
on the page, made invisible, after the pointer leaves.
It appears as soon as a lookup stores the match, comes back straight away on
a later visit, and goes when a lookup no longer finds one. As a photo may only
get its size once it loads (a lazy one), every image that loads counts until
there is a badge. Clicking it opens the popup (`whisky:open-popup`,
`chrome.action.openPopup`, Chrome 127 and later), as the toolbar icon would.

All badges are faint and grey (a frosted white pill, the icon in grey), so as
not to get in the way of the photo, and take the icon's colours when the
pointer is on them.

While a bottle is detected (whisky or possible), the page's title (the first
proper h1, `WhiskyDetector.mainHeadingElement`, which the detector also reads)
ends in a very faint grey Glencairn glass, the icon's without its square
background: an inline SVG with a dark line inside a light halo, so that it
shows on light and dark backdrops alike, in colour on hover. It is in a shadow
root so the detector doesn't read it. Its tooltip says whether the bottle is matched
to Whiskybase (a match stored for the page); clicking it opens the popup.
Each scan, and each change to the stored match, updates it.

Since it runs in the content script, lists only get badges on pages the
content script is on: every page with automatic checking on, otherwise the page
whose toolbar icon was clicked. Unlike the lookups, the stored matches are kept
in local storage, so they last after the browser closes; at about 100 bytes
each, the 10 MB that local storage allows is plenty. **Clear stored bottle
data** at the bottom of the popup removes them all (and with them the badges).

## Files

| Path | Role |
| ---- | ---- |
| `manifest.json` | Manifest V3; `storage`, `activeTab`, `scripting` and `contextMenus` (the icon's right-click menu) permissions, access to www.whiskybase.com (pages) and static.whiskybase.com (photos), and optional access to all sites (for automatic checking) |
| `src/detector.js` | Detection and extraction, no dependencies (also used by the tests) |
| `src/content.js` | Runs the detector on the page; re-scans single-page-app navigations and late-rendered content; marks images that link to bottles matched before; adds distillery names to SMWS codes on smws.com |
| `src/smws.js` | The Scotch Malt Whisky Society's codes and their distilleries, and finding them in text (no DOM; also used by the tests) |
| `src/background.js` | Per-tab badge and tooltip; automatic Whiskybase lookup; registers the content script while automatic checking is on; the icon's right-click menu entries |
| `src/whiskybase.js` | Whiskybase query, results parsing and matching (no DOM; also used by the tests) |
| `src/known-pages.js` | Keys for the page addresses of bottles matched before, for the badges on lists of bottles (no DOM; also used by the tests) |
| `popup/` | Toolbar popup with results, a Re-scan button and the automatic-checking setting; loads the detector into the tab when needed |
| `test/` | Parser unit tests, browser tests (`e2e.mjs`) and fixture pages |

## Packaging

```bash
npm run package
```

builds `dist/whiskybase-chromium-browser-extension/` and
`dist/whiskybase-chromium-browser-extension-<version>.zip`,
containing only what the extension needs (manifest, licence, `src/`, `popup/`, PNG icons).

The GitHub Actions workflow [`.github/workflows/package.yml`](.github/workflows/package.yml)
runs only when started by hand: on GitHub, open **Actions**, pick **Package
extension** and click **Run workflow**. It runs the tests and this packaging,
and uploads the extension as a workflow artifact (on the run's summary page;
needs a GitHub login, kept for 90 days).

### Publishing a release

A release is a GitHub Release with the zip attached, downloadable by anyone.
The steps, here for version 0.2.1:

1. **Describe the changes** in [`CHANGELOG.md`](CHANGELOG.md), in a new
   section at the top:

   ```markdown
   ## 0.2.1

   - What changed, as users would notice it.
   ```

2. **Bump `version`** in `manifest.json` to `0.2.1`. The Chrome Web Store
   also needs a higher version for every upload.

3. **Preview the release notes:**

   ```bash
   node scripts/release-notes.mjs 0.2.1
   ```

4. **Commit and push** `main`. The workflow file must be on GitHub's default
   branch for **Run workflow** to appear.

   ```bash
   git push origin main
   ```

5. **Tag the release commit** and push the tag:

   ```bash
   git tag v0.2.1
   ```

   ```bash
   git push origin v0.2.1
   ```

6. **Run the workflow on the tag:** on GitHub, open **Actions**, pick
   **Package extension**, click **Run workflow** and switch **Use workflow
   from** to the **Tags** tab, then pick `v0.2.1`. (Run on a branch, the
   workflow only uploads the artifact, without a release.) It fails if the tag
   doesn't match the manifest version.

7. **Check the release** under **Releases**. To publish the same version on
   the Chrome Web Store, upload its zip in the Developer Dashboard; every
   upload is reviewed again.

If a tag ends up on the wrong commit before you push it, delete it with
`git tag -d v0.2.1` and tag again. Notes of a published release can be edited
on its page on GitHub (**Edit**).

### Release notes

The workflow writes the notes with
[`scripts/release-notes.mjs`](scripts/release-notes.mjs):

- **At the top,** the install instructions in
  [`.github/release-intro.md`](.github/release-intro.md); `{version}` is
  replaced with the release's version. Edit this file to change the text for
  all future releases.
- **Below that, under "What's changed since last version",** the version's
  section of `CHANGELOG.md`: from its `## 0.2.1` heading (`## v0.2.1` and
  `## [0.2.1] - 2026-11-20` work too) to the next `## ` heading, followed by a
  link to the whole `CHANGELOG.md` on the main branch. Without such a section,
  the notes are only the install instructions.

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
in `test/run.mjs`, and adjust the detector. Fixtures are copies of other
websites' pages and are not covered by the project's MIT licence (see
[`LICENSE.md`](LICENSE.md)).

Users report such pages with the **Bottle detected wrongly on page** issue
form ([`.github/ISSUE_TEMPLATE/detector.yml`](.github/ISSUE_TEMPLATE/detector.yml)):
the zipped page, the bottle's distillery and ABV (required), its bottler, age,
vintage and other details if known, and optionally its Whiskybase URL. The
form's field ids and labels are meant to stay stable, so reports can be
processed automatically; `.github/scripts/detector-issue-input.py` reads the
fields by their labels. The pull request
template ([`.github/pull_request_template.md`](.github/pull_request_template.md))
has the matching checklist: fixture, expectation, scrubbing, `npm test`.

The GitHub Actions workflow [`.github/workflows/test.yml`](.github/workflows/test.yml)
runs the tests on every push to any branch and on every pull request.

```bash
npm run e2e
```

The browser tests ([`test/e2e.mjs`](test/e2e.mjs)) load the extension itself
into headless Chromium, in a fresh profile, and check it on fixture pages:
the Master of Malt product page is looked up and matched (Whiskybase answers
from its fixtures) and gets the title icon, the Master of Malt list then
badges that bottle (its link has a `?sku=` the product page's address
doesn't), the SMWS page gets its distillery name, and a Whisky Auction lot is
matched and badged on its photo and on a card of its list (added by the test,
as the list loads its cards by script). Pages are
served at their real addresses and every other request is blocked, so nothing
goes out. Google Chrome 137 and later ignore `--load-extension`: use Chromium
or Chrome for Testing (`CHROME_BIN`). They don't run in CI.

Pages saved while signed in contain your name, email, username, account IDs and
session tokens. Scrub them before sharing the project; your own details are
passed as options, so they are never stored in it:

```bash
python3 test/scrub-fixture.py --name "First Last" --email you@example.org --username yourname --id 12345 test/fixtures/whiskybase/new-page.html
```

Some pages hold other people's details, whoever saves them. Just Whisky's
Next.js page data (`__NEXT_DATA__`), for example, includes bidders' and
sellers' names, contact details, birth dates and bank details. The script
replaces those fields wherever they appear in that data, so run it on every
new fixture, signed in or not, and then search the page for email addresses.

Pages also embed API keys and tokens: mostly the site's own keys for the
browser (Google Maps, Shopify's storefront token, Stripe's publishable key),
sometimes a visitor's token. The script replaces them by their format (Google,
Stripe, AWS, GitHub, Slack, JWTs, Sentry, private keys) or by the name they
are given (`apiKey`, `access-token`, `client_secret`, ...). It keeps a page's
line endings, and only counts what it changed, so a second run reports nothing.
`npm test` fails if a fixture still holds a key in one of those formats.

### Fixing reported pages automatically

The workflow [`.github/workflows/detector-issue.yml`](.github/workflows/detector-issue.yml)
(**Fix detector from issue**) has a Claude agent work on a **Bottle detected
wrongly on page** issue: it adds the page as a fixture, adds an expectation in `test/run.mjs` from the
issue's details, and changes `src/detector.js` until `npm test` passes. The
workflow then opens a pull request from the branch `detector/issue-<number>`,
filled in from the pull request template, that fixes the issue. When the agent
can't make the tests pass, or the report can't be used (no zip attached, for
example), it comments on the issue instead.

**Setup**, once, on GitHub:

1. **Secret:** add an Anthropic API key as the repository secret
   `ANTHROPIC_API_KEY` (**Settings > Secrets and variables > Actions > New
   repository secret**). Only the agent's job gets it.
2. **Label:** the repository needs the label `detector`, which the issue form
   adds to new reports (**Issues > Labels > New label**).
3. **Pull requests:** under **Settings > Actions > General > Workflow
   permissions**, tick **Allow GitHub Actions to create and approve pull
   requests**. Without it the workflow can comment but not open pull requests.
4. The workflow must be on the default branch (`main`): GitHub only runs issue
   and comment triggers from there.

**Starting it:**

- **Your own issues** (from the repository's owner, members and
  collaborators): it starts when the issue is opened with the `detector`
  label, or when you add the label later.
- **Anyone else's issue:** it never starts on its own. Read the issue first,
  then post a comment that starts with `/fix-detector`.
- **By hand, or again:** comment `/fix-detector` again, or open **Actions**,
  pick **Fix detector from issue**, click **Run workflow** and enter the issue
  number. A new run for an issue cancels one still running, and updates the
  pull request (its branch is pushed with `--force`) if one is open. Edit the
  issue first if its details or attachment were wrong.

**Untrusted input.** The issue and its attachment come from anyone, so the
workflow treats them as data and limits what the agent can do:

- The first job reads the issue form with
  [`.github/scripts/detector-issue-input.py`](.github/scripts/detector-issue-input.py),
  without secrets: the fields go into a JSON file, and the zip (only from
  GitHub's own attachment storage) is unpacked in memory, keeping only the
  page's `.html` file. The fixture's name is made from the page URL, with
  only letters, digits, dots and hyphens, and ends in the bottle's Whiskybase
  ID when the issue gives its Whiskybase URL, e.g.
  `example-shop.com-glenfarclas-15-year-old-product-page-WB292924.html`.
- The page is added as a fixture and cleaned with the structural rules of
  `test/scrub-fixture.py` before the agent starts; the agent then looks for
  names, emails, usernames and account IDs that remain and scrubs them with
  the same script.
- The agent's prompt names the files and says they are data; no issue text is
  in it. It has no web access and no GitHub write access, can only edit
  `src/detector.js`, `test/run.mjs` and `test/fixtures/`, and can only run
  `npm test`, `node test/run.mjs` and `test/scrub-fixture.py`. Secrets are
  removed from the commands it runs, which needs bubblewrap; the workflow
  installs it before the agent starts.
- A separate job checks the changes on a fresh runner (only the detector,
  added lines in `test/run.mjs` with an expectation for the new page, and the
  new fixture) and runs `npm test`. The last job, the only one that can push,
  comment or open pull requests, applies the changes without running them,
  and writes the pull request with
  [`.github/scripts/detector-issue-report.py`](.github/scripts/detector-issue-report.py).

**Reviewing its pull requests:** check the fixture for personal information
(the description lists the domains of any email addresses in it) and review
the detector change like any other. The Tests workflow doesn't start for pull
requests opened by GitHub Actions; close and reopen the pull request to run
it. Each run uses Claude Opus with up to 100 turns, which costs API credit;
the agent's job times out after an hour.
