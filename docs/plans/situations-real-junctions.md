# /quiz/situations redesign — animated decision-quizzes on REAL Czech junctions (msg 3093)

Vlad: the current simulator asks for fairly pointless user *driving* input on abstract junctions. New concept:
pick **real**, genuinely tricky junctions in Prague (and other big CZ cities), **animate a non-standard traffic
situation** on each, and let the user **pick the one correct action from several options**. Junctions must be
reproduced **very precisely — every marking, sign and signpost**. Research first, write the vision, then build.

---

## 1. Research — what's actually hard, and where

### 1a. The real accident hot-spots (good candidate junctions)
Prague's official Top-10 risk junctions (regional traffic conference 2023/2024) — each comes with a *dominant
failure mode*, which is exactly the "non-standard situation" to animate:

| Junction | District | Dominant driver error → scenario |
|---|---|---|
| **I.P. Pavlova** | P2 | #1 riskiest in the whole CR; dense multi-lane + tram + pedestrians |
| **Kbelská × Novopacká** | P9 Kbely | *failure to yield when merging lane-to-lane* (zip/merge) |
| **Klárov × Valdštejnská** | P1 Malá Strana | *left-turn not yielding* to oncoming + trams |
| **Povltavská × Bulovka** | P8 Libeň | following distance / complex weave |
| **Průmyslová × Černokostelecká** | P10 Štěrboholy | high-injury multi-arm |
| **Milady Horákové × Svatovítská** | P6 Hradčany | *red-light running*, tram crossing |

(Brno/Ostrava/Plzeň have their own published risk lists — same approach when we expand.)

### 1b. The rule-trap taxonomy (what a "non-standard situation" actually tests)
From Czech driving-theory sources (bezpecnecesty.cz, autozive autoškola tests, naucseridit.cz). These are the
buckets each scenario should fall into — they map cleanly onto the rule engine the sim already cites
(§ 22 / § 21 / § 54):

1. **Neřízená křižovatka → přednost zprava** (unsigned → priority-to-the-right / "pravidlo pravé ruky").
2. **Hlavní × vedlejší** (main vs side road by P-signs) — incl. the bent-priority "hlavní zatáčí" arrow trap.
3. **Řízená** (signal-controlled) — incl. green-arrow + conditional, and the "always yield to peds you're
   turning across" rule even on green.
4. **Tramvaj** — the big one: a tram is *not* always priority. Turning tram has priority (§ 21/7); a tram going
   straight on the *priority* road does **not** beat you if you're also on the priority road (classic chyták);
   at an unmarked junction even a tram yields to the right.
5. **Kruhový objezd** — priority is set by the *sign*, not the ring shape; plus the rare CZ "exception
   roundabout" with **no give-way sign**, where circulating traffic yields to entering traffic.
6. **Odbočování vlevo** — yield to oncoming vehicles, trams in **both** directions, and dedicated-lane traffic.
7. **Přejíždění z pruhu do pruhu / řazení** — the lane-merge yield that causes the most crashes at Kbely.

### 1c. Reproducing a junction "with all markings & signs" — the data
The hard constraint. Sources, best → supporting:
- **car-sim's own OSM bake** — *we already render real junctions*: lanes, `turn:lanes`, stop-lines, zebra,
  tram rails, some signs, house numbers. This is the geometric base and it's already in the engine.
- **DTMP — Digitální technická mapa Prahy** (geoportalpraha.cz / map.dtm-praha-sck.cz, run by IPR Praha; public
  ZPS+DTI part downloadable via the ČÚZK DMVS portal). The most precise, continuously-updated survey of Prague:
  exact carriageway edges, islands, lane geometry → trace markings to-scale.
- **Ortofoto** (geoportalpraha.cz) — 1:1 aerial to read painted arrows, stop-lines, give-way triangles, zebra.
- **Panoramax / Mapillary street-level** — *car-sim already uses Panoramax for the photo quiz* — to read the
  actual upright **signs & signposts** (which OSM under-covers in CZ) and confirm lane arrows.
- **bezpecnecesty.cz** has free interactive junction animations — useful reference for scenario framing.

**Honest conclusion on accuracy:** no open dataset gives "every sign + marking" automatically — OSM sign
coverage in CZ is patchy and DTMP is geometry, not a clean "this approach has a give-way sign" semantic. So
pixel-faithful reproduction needs a **human-in-the-loop authoring step** per junction (trace over ortofoto +
verify each sign against street imagery). That's fine for a **curated set** of ~8–12 showcase junctions; it is
*not* something to fake by auto-generating hundreds inaccurately.

---

## 2. Vision / proposed solution

### 2a. Core idea
Each "level" = one **real junction reproduced to-scale**, on which a short **animation** plays a non-standard
situation (your car + other actors: cars / tram / pedestrian / cyclist approach a decision point). At the
decision point the scene **freezes** and asks a single multiple-choice question — *"How do you proceed?"* /
*"Who has priority?"* — with 3–4 options. Pick → reveal correct/incorrect → **explain with the rule + § citation**.
No twitchy driving input; it's a *judgement* test on faithful real geometry. This is essentially the UK
"hazard perception" idea, localised to CZ rules and built on real Prague junctions.

### 2b. Reuse what exists (Systems First)
- The **`/drive` renderer already draws real junctions** from the bake (signs, stop-lines, lanes, rails). Host
  the situation **at the real junction's map coordinates using the drive renderer**, instead of the current
  abstract hand-drawn canvas. → faithful geometry for free, one rendering codebase.
- The **situations sub-app** (`/quiz/situations`) already has freeze-and-explain + the rule engine
  (§ 22/§ 21/§ 54) + the **RULES/REASON i18n I just localized** → reuse the explanation + scoring + 10-language
  layer wholesale.
- **Panoramax** integration (photo quiz) → reuse to source/verify the sign imagery during authoring.

### 2c. Junction reproduction pipeline (the accuracy-critical part)
1. **Seed** geometry from the OSM bake at the junction's coords (lanes, rails, crossings, stop-lines).
2. **Correct & complete** in a lightweight authoring pass (a small in-browser junction editor, or structured
   JSON I author): place/verify every upright **sign**, lane **arrow**, **stop-line**, give-way triangle,
   priority assignment — each checked against **ortofoto** (markings) + **Panoramax** (signs). DTMP for exact
   carriageway/island geometry where OSM is coarse.
3. **Snapshot** to an extended scenario JSON so it renders deterministically and is provably-faithful.

### 2d. Extended scenario schema (superset of today's)
```jsonc
{
  "id": "praha-ip-pavlova-tram-straight",
  "city": "praha",
  "junction": { "name": "I. P. Pavlova", "lat": 50.075, "lon": 14.429, "source": "DTMP+ortofoto+panoramax" },
  "geometry": { /* lanes, stoplines, signs[], arrows[], rails[], crossings[] — to-scale, authored */ },
  "actors": [ { "type": "ego|car|tram|ped|bike", "path": [...], "speed": ... } ],
  "decisionPoint": { "t": 2.4 },          // freeze time in the animation
  "question": { "cs": "...", "en": "...", "ru": "..." },   // via the app.json i18n pipeline
  "options": [ { "text": {"cs": "...", ...}, "correct": true, "rule": "tram_straight_yields" } ],
  "ruleRefs": ["§21", "§22"]
}
```
Questions/options run through the **same Gemini translation pipeline** as the laws + `app.json`, so every
scenario is 10-language from day one.

### 2e. MVP scope (curated, Prague-first)
~6–8 hand-faithful junctions, one per rule-trap bucket:
přednost-zprava · main/side bent-priority · tram-straight-on-priority chyták · left-turn-yields-tram ·
roundabout-by-sign (+ the exception roundabout) · lane-merge yield (Kbely). Then expand to Brno/Ostrava/Plzeň
using their own risk lists.

### 2f. Phasing
- **P1** — Pipeline + schema + render one real junction (I.P. Pavlova) faithfully on the drive renderer; one
  animated scenario; multiple-choice + explain; verify against Panoramax/ortofoto.
- **P2** — Author the 6–8 MVP junctions covering all rule buckets; wire scoring/progress (reuse sim sub-app).
- **P3** — Authoring editor polish; expand to other cities; difficulty tiers; share the i18n.
- **Open for Vlad:** keep the old free-form sim as a separate mode, or fully replace it? (Leaning: replace the
  `/quiz/situations` entry with the new quiz, retire the abstract junctions.)

### 2g. Risks / honest caveats
- Per-junction authoring is **manual labour** (hours each) — that's the price of true fidelity; curate, don't mass-generate.
- DTMP licensing: public ZPS/DTI part is open for any purpose; confirm attribution terms before shipping traced geometry.
- Animation timing + freeze point need playtesting so the "decision moment" is unambiguous.

## Sources
- Prague Top-10 risk junctions — [Deník](https://www.denik.cz/zivot-ridice/dopravni-konference-praha-rizikove-krizovatky-462023.html), [Aktuálně](https://zpravy.aktualne.cz/ekonomika/auto/nejhorsi-krizovatky-v-praze/r~9c5a5fe092b411ee8d680cc47ab5f122/), [I.P. Pavlova #1 in CR](https://ekonomickydenik.cz/nejrizikoveji-krizovatka-je-v-centru-prahy-u-i-p-pavlova-vice-nez-sto-bouracek-za-dva-roky-ale-i-dalsi-mesta-maji-nebezpecna-mista/)
- Rule traps — [tram junctions](https://www.bezpecnecesty.cz/cz/autoskola/vyuka/krizovatky/krizovatky-s-tramvajemi), [roundabout exception](https://www.autozive.cz/kruhovy-objezd-prednost-vyjimka-znacka/), [autoškola junction test](https://www.autozive.cz/autoskola-krizovatka-test/), [bezpecnecesty výuka](https://www.bezpecnecesty.cz/cz/autoskola/vyuka/krizovatky)
- Reproduction data — [DTMP / Geoportál Praha](https://geoportalpraha.cz/data-a-sluzby/a8412188f2e24a64a9105d8b9665237f), [DTM Praha-SčK portal](https://portal.dtm-praha-sck.cz/), [IPR DTMP](https://iprpraha.cz/page/2606/digitalni-technicka-mapa-prahy)
