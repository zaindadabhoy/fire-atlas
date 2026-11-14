# References — every dataset, library, image and sound we use

## NASA data
- NASA Physical Sciences Informatics (PSI) — https://psi.nasa.gov — details and DOI metadata harvested 2026-11-14.

### Harvested PSI investigations
| ID | Acronym or title | DOI |
| --- | --- | --- |
| PSI-22 | ACME E-FIELD Flames | [10.60555/se5a-8c73](https://doi.org/10.60555/se5a-8c73) |
| PSI-10 | ACME/Flame Design | [10.60555/w4zy-bt45](https://doi.org/10.60555/w4zy-bt45) |
| PSI-159 | ACME CFI-G | [10.60555/cyt1-kh64](https://doi.org/10.60555/cyt1-kh64) |
| PSI-107 | SPICE | [10.60555/9kbh-e962](https://doi.org/10.60555/9kbh-e962) |
| PSI-106 | SLICE | [10.60555/pm12-rg61](https://doi.org/10.60555/pm12-rg61) |
| PSI-100 | SAFFIRE-III | [10.60555/040q-4h36](https://doi.org/10.60555/040q-4h36) |
| PSI-102 | SAME | [10.60555/gd4k-8h62](https://doi.org/10.60555/gd4k-8h62) |
| PSI-69 | FLEX | [10.60555/mbq8-0451](https://doi.org/10.60555/mbq8-0451) |
| PSI-39 | CFI | [10.60555/m6pj-a914](https://doi.org/10.60555/m6pj-a914) |
| PSI-21 | ACME CLD Flame | [10.60555/23e1-9950](https://doi.org/10.60555/23e1-9950) |
| PSI-68 | FLEX-2 | [10.60555/byp8-h018](https://doi.org/10.60555/byp8-h018) |
| PSI-26 | BASS | [10.60555/58h4-dy80](https://doi.org/10.60555/58h4-dy80) |
| PSI-117 | Effect of External Thermo-Convective Perturbation on Cool Flame Dynamics: A Multidimensional Multi-Physics CFD Analysis | [10.60555/gz0q-b577](https://doi.org/10.60555/gz0q-b577) |
| PSI-23 | ACME s-Flame | [10.60555/k57n-p030](https://doi.org/10.60555/k57n-p030) |
| PSI-20 | ACME BRE | [10.60555/vb93-3y72](https://doi.org/10.60555/vb93-3y72) |
| PSI-142 | Quantitative Studies of Cool Flame Transitions at Radiation / Stretch Extinction Using Counterflow Flames | [10.60555/80qf-vj95](https://doi.org/10.60555/80qf-vj95) |
| PSI-60 | Computational and Experimental Analysis of SPICE Data Sets | [10.60555/mzjm-yv57](https://doi.org/10.60555/mzjm-yv57) |
| PSI-62 | Concurrent Flame Spread Modeling using Flamelet Generated Manifolds in Microgravity with Comparison to BASS Experiments using Two-Color Tomography | [10.60555/e9xp-ex83](https://doi.org/10.60555/e9xp-ex83) |
| PSI-99 | SAFFIRE-II | [10.60555/2chp-m469](https://doi.org/10.60555/2chp-m469) |
| PSI-25 | BASS-II | [10.60555/4qc4-de67](https://doi.org/10.60555/4qc4-de67) |
| PSI-115 | Utilization of the Smoke Aerosol Measurement Experiment Data for Advanced Modeling and Simulation of Smoke Generation in Micro-Gravity | [10.60555/q0v5-1v28](https://doi.org/10.60555/q0v5-1v28) |
| PSI-47 | DAFT / DAFT-2 | [10.60555/ztgj-d202](https://doi.org/10.60555/ztgj-d202) |
| PSI-98 | SAFFIRE-I | [10.60555/0t15-1z43](https://doi.org/10.60555/0t15-1z43) |
| PSI-101 | SAME-R | [10.60555/2np7-jv14](https://doi.org/10.60555/2np7-jv14) |
| PSI-179 | ASE | [10.60555/pdgr-c961](https://doi.org/10.60555/pdgr-c961) |

## Background (from the challenge Resources tab)
- A Researcher's Guide to ISS Combustion Science — https://www.nasa.gov/missions/station/a-researchers-guide-to-combustion-science/
- Apollo 1 — https://sma.nasa.gov/sma-disciplines/accllp/apollo-1
- Apollo 204 Review Board findings — https://www.nasa.gov/wp-content/uploads/static/history/Apollo204/find.html
- Apollo 13 — https://sma.nasa.gov/sma-disciplines/accllp/apollo-13
- 25 Years Ago: Fire Aboard Space Station Mir — https://www.nasa.gov/history/25-years-ago-fire-aboard-space-station-mir/
- NASA Spinoff: [Fireman's Air Tanks](https://spinoff.nasa.gov/node/9582), [Fire Detector](https://spinoff.nasa.gov/node/9407), [New Technology for the Fire Attire](https://spinoff.nasa.gov/node/9918), and [Zero-Leak Valve / fine-water-mist extinguisher](https://spinoff.nasa.gov/node/11065).

### Habitat preset sources
- NASA OCHMO-TB-003, *Habitable Atmosphere* — https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf (ISS typical atmosphere: 21% O₂ at 14.7 psia, described as equivalent to sea level.)
- NASA, *Spacesuits* podcast — https://www.nasa.gov/podcasts/houston-we-have-a-podcast/spacesuits/ (100% oxygen and 4.3 psi suit pressure.)
- NASA Space Apps Challenge, supplied Fire Atlas challenge brief, *Design constraints / habitat atmosphere* (planned lunar habitat envelope: ≥30% O₂ and ≤10.2 psi). The plotted envelope and Moon base example (34% O₂, 8.2 psi) are challenge design conditions, not measured habitat data.
- Mars habitat conditions remain `null` and are labeled an assumption.

### Fonts and visuals
- Fontsource packages `@fontsource/space-grotesk`, `@fontsource/inter`, and `@fontsource/jetbrains-mono` (self-hosted bundled font assets; no browser request to `fonts.googleapis.com`). Font families were originally designed by the Space Grotesk, Inter, and JetBrains Mono projects.
- Fire Atlas favicon: `app/public/favicon.svg`, original project SVG; no external visual assets used.

## Software libraries

### App (`app/package.json`)
| Package | Version | License | Use |
| --- | --- | --- | --- |
| `react` | 19.3.1 | MIT | UI |
| `react-dom` | 19.3.1 | MIT | Browser rendering |
| `@fontsource/space-grotesk` | 5.3.x | OFL-1.1 | Self-hosted heading font |
| `@fontsource/inter` | 5.3.x | OFL-1.1 | Self-hosted interface font |
| `@fontsource/jetbrains-mono` | 5.3.x | OFL-1.1 | Self-hosted numeric / code font |
| `motion` | 14.14.0 | MIT | UI transitions and reduced-motion-aware reveals |
| `react-plotly.js` | 4.1.0 | MIT | React chart component |
| `plotly.js-dist-min` | 4.3.0 | MIT | Plotly browser bundle |
| `@types/react-plotly.js` | 2.6.4 | MIT | React Plotly types |
| `@types/plotly.js` | 3.0.15 | MIT | Plotly types |
| `vite` | 8.3.8 | MIT | Dev server and build |
| `@vitejs/plugin-react` | 6.3.0 | MIT | Vite React support |
| `typescript` | 7.0.2 | Apache-2.0 | Type checking |
| `@types/react` | 19.3.0 | MIT | React types |
| `@types/react-dom` | 19.3.0 | MIT | React DOM types |
| `@types/node` | 24.19.2 | MIT | Node types for Vite config |
| `oxlint` | 1.93.0 | MIT | Scaffold lint script |
| `tsx` | 4.23.15 | MIT | Run the briefing precompute script |

### QA tools (not runtime dependencies)
| Package | Version | License | Use |
| --- | --- | --- | --- |
| `playwright` | 1.65.1 | Apache-2.0 | Browser UI, responsive, and console verification; installed locally without saving to the app manifest |
| Lighthouse CLI | 13.6.0 | Apache-2.0 | Desktop performance audit |

### Data pipeline (`pipeline/requirements.txt`)
| Package | Installed version | License | Use |
| --- | --- | --- | --- |
| `requests` | 2.34.2 | Apache-2.0 | PSI API and signed downloads |
| `pandas` | 3.1.1 | BSD-3-Clause | CSV and Excel table inspection |
| `openpyxl` | 3.1.5 | MIT | Excel table reading |

## Media (demo video)
- **Narration:** ElevenLabs text-to-speech, voice "George", model `eleven_multilingual_v2` (free tier; SI-generated voice — disclosed on the end card and by the "SI-assisted production" watermark). https://elevenlabs.io
- **Ambient drone bed:** synthesized by the team with FFmpeg (`aevalsrc` sine chord + filtered pink noise); no third-party music.
- **Sound effects:** team-supplied royalty-free SFX library (impacts, sub drops, whooshes, UI/data sounds, heartbeat), including Mixkit free sound effects (https://mixkit.co/free-sound-effects/, Mixkit License).
- **Footage:** screen recordings of the FIRE ATLAS app itself (https://fire-atlas-tau.vercel.app). No NASA imagery or logos are used; the Moon crescent is drawn in SVG.
- **Apollo 1 facts on screen:** Apollo 204 Review Board findings (100 % O₂ at 16.7 psia; crew Gus Grissom, Ed White, Roger Chaffee) — https://www.nasa.gov/wp-content/uploads/static/history/Apollo204/find.html

### Video tooling
| Package | Version | License | Use |
| --- | --- | --- | --- |
| `remotion`, `@remotion/cli` | 4.0.543 | Remotion License (free for individuals and teams ≤ 3 employees) | Programmatic video composition and rendering |
| `playwright` | 1.65.1 | Apache-2.0 | Scripted app recording (Chrome DevTools screencast) |
| FFmpeg | 9.0.2 (gyan.dev build) | LGPL/GPL | Encoding, loudness normalization (EBU R128) |

