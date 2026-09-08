# Visual privacy fixtures

These are frozen, synthetic visual inputs for controlled browser evaluation. They intentionally contain only fake identifiers, an illustrated avatar, and one AI-generated fictional portrait; never add a customer screenshot, a real face, or a real credential.

Run `npm run fixtures:rasterize` from the repository root to rasterize every source through local headless Chrome. It creates timestamped PNGs and a hash/timing `run.json` under the ignored `artifacts/visual-fixtures` directory. Use `-- --out artifacts/visual-fixtures/my-run` to choose a new, repository-local output directory, or `-- --chrome /path/to/chrome` to choose the browser binary.

The `manifest.json` boxes use each source asset's pixel coordinates. A browser harness must rasterize an asset at the declared dimensions, run the local offscreen detector and renderer, then pass the returned mask rectangles to `evaluateRedaction()`.

`surface` records the browser surface the harness must emulate. `canvas_like` must be painted to a `<canvas>` rather than read from DOM text, `profile_image` must be rendered as an image, and the `dom` page must retain its real input semantics. `unknown` has no mask label: its expected policy is withholding visual export. The SVGs are sources—not proof that YuNet or PP-OCR detects every fixture. A fixture only becomes a scored result after a controlled browser run records its masks, timings, runtime provider, and model version.
