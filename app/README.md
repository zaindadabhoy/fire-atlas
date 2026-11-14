# FIRE ATLAS — web app

Vite + React + TypeScript single-page app with two Vercel serverless functions:

| Path | Purpose |
|---|---|
| `src/App.tsx` | Atlas (2D/3D), habitat check, briefing drawer, story mode |
| `src/lib/layers.ts` | O₂ partial-pressure isobars, stacked-test aggregation, coverage layer, 3D evidence towers |
| `src/lib/rank.ts` | Deterministic investigation ranking (shared with the API) |
| `src/lib/parseQuestion.ts` | Deterministic plain-English question parser (fallback for the SI parser) |
| `src/SourceRowModal.tsx` | Shows the original NASA CSV row behind any test |
| `src/InsightsView.tsx`, `src/CompareView.tsx`, `src/DataView.tsx` | Insights, comparison and export tabs |
| `api/briefing.ts` | Evidence pack → SI → verifier → cited briefing |
| `api/parse-question.ts` | SI question parser with deterministic fallback |
| `api/prompts/` | The exact system prompts used at runtime |
| `public/data/` | Normalized PSI data produced by `../pipeline` |
| `public/raw/` | Untouched NASA PSI tables (published by `pipeline/publish_raw.py`) |

```bash
npm install
npm run dev        # http://localhost:5173 — /api routes are served by a Vite plugin locally
npm run build
node scripts/qa-e2e.mjs http://localhost:5173   # 34 end-to-end checks (desktop + mobile)
```

Environment variables (server-side only, all optional): `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_FALLBACK_MODEL_2`, `GROQ_API_KEY`, `GROQ_MODEL`. Without keys the app serves stored SI-written briefings for presets and computed, fully cited briefings for custom queries.
