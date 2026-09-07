# Visual privacy fixtures

These are frozen, synthetic visual inputs for controlled browser evaluation. They intentionally contain only fake identifiers and an illustrated avatar; never add a customer screenshot, a real face, or a real credential.

The `manifest.json` boxes use each source asset's pixel coordinates. A browser harness must rasterize an asset at the declared dimensions, run the local offscreen detector and renderer, then pass the returned mask rectangles to `evaluateRedaction()`.

`surface` records the browser surface the harness must emulate. `canvas_like` must be painted to a `<canvas>` rather than read from DOM text, `profile_image` must be rendered as an image, and the `dom` page must retain its real input semantics. `unknown` has no mask label: its expected policy is withholding visual export. The SVGs are sources—not proof that YuNet or PP-OCR detects every fixture. A fixture only becomes a scored result after a controlled browser run records its masks, timings, runtime provider, and model version.
