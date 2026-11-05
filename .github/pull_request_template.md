<!--
Thanks for the fix! For detector fixes, the checklist below keeps the tests
covering the page. For other changes, delete what doesn't apply.
-->

## What this changes

<!-- Which page or site was detected wrongly, and what the detector does now. -->

Fixes #<!-- issue number -->

## Detector fixes

- [ ] The page is added to `test/fixtures/` (and its Whiskybase page to `test/fixtures/whiskybase/`, if there is one), named after the site and the bottle, e.g. `hedonism-glendronach-14yo-boynsmill-house-product-page.html`.
- [ ] `test/run.mjs` has an expectation for the page, with the details from the issue (at least distillery and ABV).
- [ ] The fixtures contain no personal information. Pages saved while signed in were cleaned with `test/scrub-fixture.py` (see DEVELOPMENT.md), passing the personal details as options so they don't end up in the repository.
- [ ] `npm test` passes, including all the existing fixtures.

## Other checks

- [ ] `README.md` or `DEVELOPMENT.md` is updated, if the change affects what they describe.
- [ ] For user-facing changes: a line under the next version in `CHANGELOG.md`.
