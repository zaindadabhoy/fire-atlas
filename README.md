# FIRE ATLAS

**A pre-flight fire check for any habitat atmosphere — built on every microgravity combustion test in NASA's Physical Sciences Informatics (PSI) database.**

NASA Space Apps Challenge 2026 · *Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data* · Team **Guatians** (Karachi)

🔗 **Live app:** https://fire-atlas-tau.vercel.app · 🎬 **30-second demo:** [`docs/media/fire-atlas-demo.mp4`](docs/media/fire-atlas-demo.mp4)

---

## The finding

> **Every solid material in PSI — 263 tests of fabrics and plastics — was tested at 22.2 % O₂ or less. Planned lunar habitats will run at ≥ 30 % O₂ (the challenge example: 34 % at 8.2 psi). Inside that envelope there are zero solid-material tests.**

The Moon base has almost the same O₂ *partial pressure* as Earth (2.79 vs 3.07 psi) but 63 % more oxygen *by fraction* — exactly the regime where NASA's own data is silent. FIRE ATLAS makes that gap visible, cites every number to the original NASA row, and tells engineers which test would close it.

## What it does

| Feature | What you see | Challenge objective |
|---|---|---|
| **Combustion atlas** | 1,719 tests on O₂ × pressure, colored by outcome, shaped by fuel phase; stacked tests sized by count; curves of constant O₂ partial pressure; lunar habitat envelope | Targeted discovery |
| **Evidence coverage layer** | Glow where tests exist for a phase — the empty lunar envelope reads as empty | Hyperoxia question |
| **3D evidence towers** | Tests per 5 % O₂ × 1 psi cell as towers; translucent lunar box | Cross-investigation view |
| **Habitat check + SI briefing** | Pick a habitat/material; SI writes a briefing where **every sentence is cited and every number verified** against the data | SI interpretation & ranking |
| **Ask in plain English** | "Would Nomex burn in a lunar rover?" → SI parses → cited briefing | SI integration |
| **Original NASA record** | Any point → the exact row of NASA's CSV, unmodified, with the used columns highlighted | Validity / traceability |
| **Insights** | Gravity bounds (same SAFFIRE-II samples at 1 g vs microgravity) and a material readiness matrix | Gravity bounds 0 g–1 g, safety controls |
| **Compare** | All 25 investigations side by side; hardware × fuel-phase matrix (CIR+ACME, CIR+MDCA, MSG+SPICE duct, Saffire) | Cross-investigation comparison |
| **Data export** | Filtered tests as CSV/JSON with provenance columns and DOIs | Predictive data extraction |

## How the SI is kept honest

```
PSI API → harvest (25 investigations, 22 tables) → normalize (1,719 tests, provenance per value)
        → findings engine (deterministic, 97 source-backed facts)
        → evidence pack → SI (Gemini → Gemini Lite → Groq) → verifier → cited briefing
```

* Deterministic code computes every fact; the SI only explains facts it is handed.
* The **verifier** drops any citation not in the evidence pack, rejects any number that does not appear in the data, and rejects unsupported risk language.
* If every provider fails, the app falls back to a computed, fully cited briefing — the demo never depends on a free tier.
* Assumed values (e.g. unrecorded cabin pressure) are flagged, drawn hollow, and never counted as measured coverage.

## Run it locally

```bash
# 1 · data pipeline (Python 3.11+)
pip install -r pipeline/requirements.txt
python pipeline/harvest.py        # downloads PSI investigations + tables (cached in data/raw)
python pipeline/normalize.py      # 1,719 normalized tests with provenance
python pipeline/findings.py       # deterministic facts and rankings
python pipeline/validate.py       # traceability + unit-conversion checks
python pipeline/publish_raw.py    # ships the untouched NASA CSVs for the record viewer

# 2 · web app (Node 20+)
cp .env.example .env              # add free Gemini / Groq keys (optional — app works without them)
cd app && npm install && npm run dev

# 3 · end-to-end checks (34 checks, desktop + mobile)
node scripts/qa-e2e.mjs http://localhost:5173
```

Stack: Vite + React + TypeScript, Plotly.js, Motion · Python (requests, pandas) · Vercel serverless functions · Google Gemini / Groq free tiers.

## Repository map

| Path | Contents |
|---|---|
| `pipeline/` | Harvest, normalization, findings, validation, raw publishing |
| `data/raw/` | Untouched PSI downloads (audit trail) · `data/processed/` normalized outputs |
| `app/` | Web app; `app/api/` serverless SI endpoints and their prompts |
| `docs/` | Data dictionary, SI usage, references, prompt transcript, demo video |
| `video/` | Source for the demo video (Remotion scenes + app recorder) |

## Data & credits

All data: **NASA Physical Sciences Informatics** (https://psi.nasa.gov). Each investigation is cited by DOI in the app (Data → How to cite) and in [`docs/REFERENCES.md`](docs/REFERENCES.md). This project is not affiliated with or endorsed by NASA.

SI tools used are disclosed in [`docs/SI_USAGE.md`](docs/SI_USAGE.md); the prompts used to build the project are in [`docs/PROMPT_TRANSCRIPT.md`](docs/PROMPT_TRANSCRIPT.md).

**Team Guatians** — Yousuf · Zain · Ibraheem · Ahsan · Huzaifa · Shamoeel

Code released under the MIT License.
