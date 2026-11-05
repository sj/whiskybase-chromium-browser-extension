# Bottle lookup for Whiskybase

Recognises when the current web page shows a single bottle of whisky, pulls out
its details, and looks the bottle up on whiskybase.com.


![Screenshot (closeup)](https://github.com/sj/whiskybase-chromium-browser-extension/blob/main/screenshots/fettercairn-50-closeup.jpg)



Click the extension's toolbar icon on a page to check it. Afterwards, the icon shows:

| Badge | Meaning |
| ----- | ------- |
| green ✓ | whisky bottle detected |
| amber ? | possibly a whisky bottle |
| (none) | no whisky bottle |

Click the icon to see the extracted details (name, brand, distillery, bottler,
age, ABV, volume, vintage/bottled year, cask number, EAN) and, under
**Details of parsed data**, every signal that added or removed points. 

If and when a whisky bottle is detected on a webpage, the extension will automatically try and find the bottle's Whiskybase entry.

By default, the extension only looks at a page when you click its icon, so it doesn't need access to the websites you visit. To have every page checked as it loads, with the badge and the Whiskybase lookup happening without a click, tick **Check every page automatically** at the bottom of the popup. Chrome then asks you to allow access to all websites. Unticking it stops the automatic checks; to also withdraw the access, change **Site access** on the extension's details page in `chrome://extensions`.

**Please note**: This is an independent project; it is not affiliated with or endorsed by
Whiskybase. 

## Install the extension in your browser using an official release

Download `whiskybase-chromium-browser-extension-<version>.zip` from the
repository's **Releases**
page and unzip it. Then follow the steps below, picking the unzipped folder at
**Load unpacked**.

## Install a development version in your browser

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select an unzipped release artifact or a Git clone of this repository.
3. Pin the extension (puzzle-piece icon → pin) so you can see its badge.


## Whiskybase lookup

Whiskybase has no public API, so the extension uses Whiskybase's own search. It does this in the background, using your browser's cookies for Whiskybase. You don't have to be logged in to Whiskybase for this extension to work, but logging in might help with search rate limiting.

The extension only reaches out to Whiskybase if and when it has detected a whisky bottle with at least 90% confidence. You can always perform a manual search straight from the extension; this will open a new tab with Whiskybase search results.

## A page detected wrongly?

If the extension misses a bottle on a page, or gets its details wrong, please
[open an issue](https://github.com/sj/whiskybase-chromium-browser-extension/issues/new?template=detector.yml)
with the **Page detected wrongly** form. It asks for a saved copy of the page
(zipped), the bottle's distillery and ABV, and any other details you know.

## Licence

The extension is released under the [MIT licence](LICENSE.md). The saved web
pages in `test/fixtures/` and the images in `screenshots/` show other websites,
whose content belongs to their owners; they are not covered by the licence.
