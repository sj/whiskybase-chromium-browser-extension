# Changelog

For each release, changes are listed below. When a release is published, the changelog for that particular version is added to the GitHub Release notes, below the install instructions.

## Under development (not released yet)

- The ABV is found when a shop gives it without the percent sign ("ABV: 59.7").
- A small copy icon next to the Whiskybase ID copies it (e.g. WB233907) to the clipboard.
- The popup no longer jumps around while the Whiskybase details load: the space for the photo and the price estimate is kept free from the start, with a spinner until they arrive. Without a photo, a generic bottle picture is shown; without a price, N/A. A long name and bottling series stay on one line, with the full text as a tooltip.
- Lists of bottles without structured data are no longer taken for a single bottle.
- On smws.com, the Scotch Malt Whisky Society's bottle codes get the distillery's name after them: "3.369 (Bowmore)".
- On lists of bottles (a shop's whisky section, say), the extension checks whether it has any information readily cached about any of the bottles. If one of the bottles in the list was previously matched to Whiskybase, the extension adds a subtle small badge with the Whiskybase rating. It only uses what the extension already looked up: nothing is looked up for it (this is to avoid triggering a large number of searches and matches for every shop bottle list). Clicking a badge opens the extension on that bottle. There's a new button 'Clear stored bottle data' at the bottom of the popup that clears the cache of information. Information is only ever stored locally, never transmitted.
- On a bottle page, when a bottle is recognised, two badges are added: one very faint/transparent one next to the bottle name (just an icon), and one on the main image of the bottle (showing the Whiskybase score, if/when available). Clicking them opens the extension.
- When several bottles were opened in background tabs and their searches failed, switching to one of those tabs now searches again straight away if a Whiskybase helper tab has been opened since, instead of asking you to search manually.

## 0.3.3

- On Whiskybase itself, the extension no longer scans the page or looks anything up; the popup just says you're looking at Whiskybase.
- Small textual change/clarification when there's no confident match but several candidates

## 0.3.2

- When a bottle is only possibly detected, the popup offers **Find this bottle on Whiskybase** to look it up anyway, and links to the README on how to let us know if the detection is wrong.
- Better bottle names on auction pages whose heading only names the lot, such as whiskyauction.com (#13)
- Better detection on more shops and auction sites, tested with pages from La Maison du Whisky, The Whisky World, The Whisky Barrel, Abbey Whisky, Loch Fyne Whiskies, Dekanta, Whisky.nl, Passie voor Whisky, Weinquelle Lühmann, Flaviar, Whisky.Auction, Just Whisky, The Grand Whisky Auction, Speyside Whisky Auctions and Prestige Whisky Auction. Among other things, the extension now reads the strength of old British bottles in UK proof ("75° proof" is 43%), and sizes in fluid ounces.

## 0.3.1

- When no bottle is detected on a page, or a detected bottle isn't matched to Whiskybase, the popup links to the README on how to let us know.
- A few updates to the detector/parser (e.g. #9)
- An **About & feedback** link at the bottom of the popup, and **More information about this extension** and **Report a problem with this extension** in the menu when you right-click the extension's icon.
- Chore: add a Privacy section to the README

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
