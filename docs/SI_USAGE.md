# Use of SI (Super Intelligence)

| Tool | Used for | Where |
|---|---|---|
| ChatGPT (developer agent) | Writing the offline PSI harvest/normalization pipeline and Atlas code from task prompts; deriving normalized values only from cached PSI rows with explicit assumptions | `pipeline/`, `app/`, `data/processed/`, `app/public/data/`, `docs/DATA_DICTIONARY.md` |
| Claude (Claude Code) | Project structure, task prompts, code review and testing, final QA fixes and UI polish (ranking, citation labels, SI time budget, story mode), deployment, demo video production | `docs/PROMPT_TRANSCRIPT.md`, `app/`, `video/` |
| ElevenLabs | Synthetic voice-over (narration) for the demo video | demo video |
| Google Gemini / Groq (free tier, in-app runtime) | Habitat Check briefings with citations to PSI test rows; next-experiment drafts | `app/api/` |

The team chose and shaped the concept and made all scope, design and feature decisions; SI tools were used for implementation, review, runtime analysis and media. The demo video carries a visible "SI-assisted production" watermark, and its narration is an SI-generated voice.

## Runtime SI: cited habitat briefings

The application treats PSI data as the source of truth. Run the offline data pipeline in this order:

```text
python pipeline/normalize.py
python pipeline/findings.py
python pipeline/validate.py
python pipeline/publish_raw.py
```

`findings.py` computes habitat coverage, source-backed headline facts, and precomputed investigation rankings. The app uses the same ranking weights for live inputs. A PSI source row remains traceable through its normalized test ID, source filename, and one-based source row.

When a user runs a custom Habitat Check, the server builds a compact evidence pack from normalized tests and deterministic findings: at most six nearby or phase-relevant tests, three ranked investigations, and twelve facts covering coverage, partial pressure, relevant trends, and a matched material contrast. The packed JSON is capped at an estimated 3,500 tokens. The model receives only that pack and the briefing instructions; it is asked to explain and cite engineering implications rather than calculate or supply independent safety data. The prompt requests 5–7 cited sentences and 2–3 distinct next-test windows with a gap citation and rationale.

The provider chain is Gemini `GEMINI_MODEL`, Gemini `GEMINI_FALLBACK_MODEL`, Gemini `GEMINI_FALLBACK_MODEL_2` (default model `gemini-flash-lite-latest`), then Groq `GROQ_MODEL`. Gemini and Groq generation is capped at 1,200 output tokens. API keys and model names are read from server environment variables (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_FALLBACK_MODEL_2`, `GROQ_API_KEY`, and `GROQ_MODEL`); they are never included in browser code or logs. Calls use plain `fetch`, a 25-second timeout, and one retry after transient HTTP errors or invalid JSON. The local Vite route loads the project-root `.env`; the deployed route uses the same handler at `/api/briefing`.

After a provider responds, the verifier removes unsupported citation keys, drops sentences left without a valid citation, drops risk claims that exceed the evidence, and drops sentences containing unsupported numbers (numeric matches use a ±0.05 tolerance). A generated SI answer is retained when at least four valid sentences remain. If fewer than four remain, the server tries the next configured provider/model candidate; only when no candidate reaches four valid sentences does it use the deterministic computed-facts fallback. Missing next-test rows can be filled from the same deterministic evidence without replacing valid SI sentences. Preset caches are precomputed into `app/public/data/briefings/`; the generator waits eight seconds between presets and records provider, model, and headline for each cache.

The Compare view uses the challenge's explicit PSI accession-to-suite map (`pipeline/hardware_mapping.py`); the five analysis/modeling entries show related investigation acronyms when PSI provides those relations. Summary-only condition ranges remain labeled as summary ranges. Ranking multiplies condition proximity by 1.0 for a matching phase and 0.4 for a different phase, then shows the factor with the score breakdown. The Data view exports the currently filtered, flattened test rows as CSV or JSON with provenance, quality flags, and investigation DOI links. Filenames contain a stable hash of the active filters.

## Runtime SI: plain-English questions

The "Ask in plain English" box sends the question to `/api/parse-question`. The SI (same provider chain, 4.5 s budget) converts it into structured cabin conditions using `app/api/prompts/parse.system.txt`; every field is range-checked and the material is mapped onto the PSI material catalog. If the SI is slow, rate-limited, or unavailable, a deterministic keyword parser (`app/src/lib/parseQuestion.ts`) produces the interpretation instead, and the UI states which path was used. The parsed conditions then run through the normal cited briefing.

## Non-SI analysis features (deterministic)

- **O₂ partial-pressure isobars, coverage layer, 3D evidence towers** — computed in the browser from the normalized tests (`app/src/lib/layers.ts`); no modeling or interpolation beyond counting and a display-only smoothing kernel for the coverage glow.
- **Original NASA record viewer** — `pipeline/publish_raw.py` copies the untouched PSI CSVs into the app; the viewer shows the exact source row behind any point.
- **Gravity bounds and material readiness** — computed from SAFFIRE-II 1 g / microgravity columns and the normalized solid tests (`app/src/InsightsView.tsx`).
