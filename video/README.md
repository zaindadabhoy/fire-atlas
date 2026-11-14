# Demo video source

The 30-second demo (`docs/media/fire-atlas-demo.mp4`) is built programmatically:

* `record/record.mjs` — records the live app with the Chrome DevTools screencast (Playwright), producing 1080p 30 fps clips.
* `studio/` — a [Remotion](https://www.remotion.dev) project: `src/scenes.tsx` (motion graphics and app shots), `src/Video.tsx` (timeline, captions, sound design), `src/theme.ts` (timings synced to the narration).

Recorded footage, narration audio and third-party sound effects are not included in this repository; see `docs/REFERENCES.md` for their sources. Fonts in `studio/public/fonts` are Space Grotesk, Inter and JetBrains Mono (SIL Open Font License).
