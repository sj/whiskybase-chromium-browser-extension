# Notes for coding agents

Bottle lookup for Whiskybase is a Chromium (Manifest V3) extension: it
recognises a whisky bottle on a web page and looks it up on Whiskybase. Plain
JavaScript, no dependencies and no build step. [`README.md`](README.md) is for
users; [`DEVELOPMENT.md`](DEVELOPMENT.md) explains how everything works. Read
the section of `DEVELOPMENT.md` for the part you change before changing it.

## Rules

- **Never bypass Cloudflare or other bot checks** on Whiskybase or elsewhere:
  no workarounds for challenges, rate limiting or blocks. The extension pauses
  and lets the user deal with them (see "Rate limiting and other checks").
- **No personal data in the repository.** Pages saved while signed in hold
  names, emails, account IDs and tokens. Scrub fixtures with
  `test/scrub-fixture.py`, passing the personal values only as its options:
  never write them into a file, commit message or pull request, and never put
  scrubbed values back.
- **Keep requests to Whiskybase down.** Lookups are automatic only for
  confident detections; badges and other page additions use stored data and
  never look anything up.
- **Privacy:** everything the extension stores stays in the browser. A change
  to what is stored or sent needs the README's Privacy section updated too.
- **British English** in prose and messages ("recognise", "colour", "licence");
  the licence file is still named `LICENSE.md`.
- Update `README.md`, `DEVELOPMENT.md` and the "Under development" section of
  `CHANGELOG.md` along with user-visible changes. Match the surrounding code:
  comments say why, in the same terse style.

## Where things are

| Path | What |
| ---- | ---- |
| `src/detector.js` | Detection and extraction from a page's DOM; also run by the tests |
| `src/content.js` | Content script: runs the detector, adds badges, title icon and SMWS notes to the page |
| `src/background.js` | Service worker: lookups, toolbar badge, stored matches, messages (`whisky:*`) |
| `src/whiskybase.js` | Whiskybase search and page parsing, matching (no DOM) |
| `src/known-pages.js`, `src/smws.js` | Keys for stored matches; SMWS codes (no DOM) |
| `popup/` | The toolbar popup |
| `test/run.mjs`, `test/e2e.mjs` | Unit and detector tests; browser tests of the extension |
| `test/fixtures/` | Saved pages (shops, auctions, Whiskybase), scrubbed |

## Checking a change

- `npm test` runs the parser tests in Node and every fixture through the
  detector in headless Chromium (set `CHROME_BIN` if needed). A page detected
  wrongly gets a fixture and an expectation in `test/run.mjs`.
- `npm run e2e` loads the extension itself into headless Chromium and checks
  it on fixture pages: lookup and stored match, title icon, list badges, SMWS
  notes. Run it after changing the content script, background or popup, and
  add a check for new behaviour there. It is offline: fixtures are served at
  their real addresses, Whiskybase answers from its fixtures, everything else
  is blocked.
- Fixtures load without the shops' stylesheets and images, so anything that
  depends on layout (where a badge sits on a photo, what is visible) needs a
  small test page of your own, or a check on the live site by the user.

## Things that are easy to get wrong

- The manifest has no content scripts. The popup injects them (`activeTab`)
  and the background registers them for automatic checking: the file list is
  in both `popup/popup.js` and `src/background.js` (a test checks they match).
- Everything the extension adds to a page sits in a shadow root, so page
  styles leave it alone and the detector, which reads the page's text, doesn't
  see it. Hosts are marked `data-bottle-lookup`, `-page`, `-title`, `-smws`.
- Content scripts run in an isolated world: a page's own scripts (or
  `Runtime.evaluate` in the page) can't see `WhiskyDetector`. Ask the content
  script with `chrome.tabs.sendMessage(tabId, { type: 'whisky:get' })`.
- Chromium keeps an unpacked extension's old service worker code in a profile
  it ran in before, until the version number changes: test in a fresh profile
  (`npm run e2e` makes one each run).
- Google Chrome 137 and later ignore `--load-extension`; use Chromium or
  Chrome for Testing for browser tests.

## The issue workflow's agent

[`.github/workflows/detector-issue.yml`](.github/workflows/detector-issue.yml)
runs Claude Code on reported pages, with this file. That agent may only edit
`src/detector.js`, `test/run.mjs` and fixtures, and run `npm test` and the
scrub script: if that is you, follow the workflow's prompt; `npm run e2e` and
the documentation updates above don't apply.
