# Browser support boundary

Nudge is currently a **Chrome/Chromium Manifest V3 prototype**. It is not packaged, tested, or supported for Firefox.

## Verified in this repository

- Production extension build: `npm exec --yes pnpm@9.15.5 -- --filter @nudge/extension build`.
- Frozen visual fixtures: `npm run fixtures:rasterize` completed locally with Google Chrome `151.0.7922.173` on Linux, creating only ignored local raster/hash/timing evidence.
- Unit and contract tests exercise extension code with mocked Chrome APIs; they are not a browser compatibility certification.

## Why Firefox is not claimed

The privacy-critical visual path currently depends on Chrome extension APIs and packaging behavior, including:

- `chrome.sidePanel` for the user interface;
- `chrome.offscreen` and `chrome.runtime.getContexts` to keep raw screenshot OCR/face inference out of the service worker;
- `chrome.tabs.captureVisibleTab` and `chrome.scripting.executeScript` for the local capture/redaction path.

Do not load the existing `apps/extension/dist` into Firefox or describe it as cross-browser. A Firefox port requires a separately reviewed manifest/build target and an equivalent isolation design for the offscreen vision host. It must pass the same raw-pixel egress, local-redaction, residue, action-policy, and fixture tests before being advertised.

## Demo/release guidance

For SIH demonstration use a recent Chrome or Chromium build, load `apps/extension/dist` as an unpacked extension, and state “Chrome/Chromium prototype” on the demo slide. If Chrome APIs or local vision initialization fail, Nudge must withhold visual export rather than use a raw-image fallback.
