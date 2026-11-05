# Changelog

For each release, changes are listed below. When a release is published, the changelog for that particular version is added to the GitHub Release notes, below the install instructions.

## Under development (not released yet)

- When no bottle is detected on a page, or a detected bottle isn't matched to Whiskybase, the popup links to the README on how to let us know.

## 0.3.0

- When a search fails for whatever reason, the popup offers **Search on Whiskybase**: it opens the search in a tab, and once search results are available, the result appears in the browser extension too. For as long as needed, the extension does its searches through that Whiskybase tab (as long as the tab stays open on Whiskybase).
- Fewer requests to Whiskybase: the bottle page (reviews, series, price, photo) is only fetched when you open the extension, and requests are spaced further apart. This should reduce traffic and load.
- Smoother release process with release notes automated
- UX improvements (#6)
- Chore: add MIT licence
- Chore: add GitHub issue template for fixing errors in the detector/parser, and set up Claude integration for that type of issue

## 0.2.0

- Updated extension permissions: by default, the extension only kicks into action when you click its icon. That means that installing the extension no longer asks for access to all websites.
- Optional new setting in the popup: **Check every page automatically**. It asks for access to all websites, and then checks pages as they load, as before.
- If the extension has no access to Whiskybase, the popup says so and offers a button to allow it again.
- The bottling series as specified on Whiskybase, when it has one, is shown after its name.

## 0.1.1

- Updated extension permissions: asks for access to www.whiskybase.com and static.whiskybase.com only, instead of every whiskybase.com subdomain.
- New icon: a Glencairn glass.
