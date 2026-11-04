# Bottle lookup for Whiskybase

Recognises when the current web page shows a single bottle of whisky, pulls out
its details, and looks the bottle up on whiskybase.com.


![Screenshot (closeup)](https://github.com/sj/whiskybase-chromium-browser-extension/blob/main/screenshots/fettercairn-50-closeup.jpg)



On any page, the browser extension's toolbar icon shows:

| Badge | Meaning |
| ----- | ------- |
| green ✓ | whisky bottle detected |
| amber ? | possibly a whisky bottle |
| (none) | no whisky bottle |

Click the icon to see the extracted details (name, brand, distillery, bottler,
age, ABV, volume, vintage/bottled year, cask number, EAN) and, under
**Details of parsed data**, every signal that added or removed points. 

If and when a whisky bottle is detected on a webpage, the extension will automatically try and find the bottle's Whiskybase entry.

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
