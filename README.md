# car-sim

A driving-education web app scoped to a chosen **country → city → language**. Its flagship is a
**free-roam, top-down 2D driving simulator built from real map data** — drive a car through a real
city's actual streets, with real per-segment speed limits, signs, markings and signals, and live
warnings when you break a rule. Around it sit a **Quizzes** section (photo quiz, situation
simulator, sign trainer, rules flashcards) and an **Official-Documents** section (laws + search +
freshness tracking).

**Live:** https://car-sim.troyanenko.com · **First city:** Prague (one district first, then expand).

> Work in progress, built in the open. Each module goes through research → analysis → spec →
> planning → implementation; see [`docs/`](docs/). The overall design is in
> [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Sections (each on its own URL)

| URL | Section | |
|---|---|---|
| `/` | Intro — pick country, city, UI language | |
| `/drive` | **Real-map driving simulator** | primary |
| `/quiz` | Quizzes: photo · situations · signs · rules | secondary |
| `/docs` | Official documents — laws & rules, searchable | secondary |

## Controls (simulator)

`↑/↓` gas / reverse · `←/→` steer · `Space` hard brake — tuned to feel like an automatic. A
speedometer and real per-segment limit warnings are always on; leaving the mapped area brakes the
car with a "turn around" prompt.

## How a city is built

Real streets come from **OpenStreetMap** (© OpenStreetMap contributors, ODbL): an offline bake
turns an OSM extract + a country **rules profile** (driving side, default limits, sign set,
priority model) into a compact tiled map the browser streams. Adding a new country/city is a
defined, repeatable procedure — see [`docs/procedures/`](docs/procedures/).

## Status

- [x] OSM data feasibility research (Prague)
- [x] Overall architecture
- [ ] Real-map simulator: spec → district vertical slice → expand
- [ ] Quizzes section (photo-quiz + situation-sim content already produced, to be ported)
- [ ] Official-documents section
- [ ] Country/city onboarding procedure

## Licence & data

Code: MIT. Map data © OpenStreetMap contributors (ODbL). Street photos via Panoramax (CC-BY-SA).
Legal texts are public. Educational project — always verify against current law.
