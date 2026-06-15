# Official Documents (`/docs`) — plan (msg 2802c)

> Vlad: "следующим шагом добавь Официальные документы." Intro card promised:
> "Laws & rules of the road, searchable, kept current."

## Goal
A `/docs` section presenting the official Czech road-rule documents in a structured,
**searchable** way, tied to the quiz (same § references), and **kept current** by
deep-linking every item to the authoritative always-current source.

## Sources (authoritative, free)
- **e-Sbírka** — official electronic collection: https://www.e-sbirka.cz / e-sbirka.gov.cz
- **Zákony pro lidi** — https://www.zakonyprolidi.cz/cs/2000-361 (stable per-§ anchors)
- Key acts:
  - **Zákon č. 361/2000 Sb.** — o silničním provozu (rules of the road)
  - **Vyhláška č. 294/2015 Sb.** — dopravní značky (traffic signs)

## Approach (MVP)
Do NOT copy the full statute into the app (huge + goes stale). Instead:
1. **Curated, themed entries** for the rules that matter (and that the quiz tests):
   obecné povinnosti, rychlost, předjíždění, odbočování, přednost v jízdě, přechody/chodci,
   tramvaje, světelné signály, zóny, kategorie značek.
2. Each entry: `§` reference, short **accurate plain-language summary in CS + EN**, theme tag,
   and a **deep-link to the authoritative verbatim paragraph** (always current).
3. **Top-level links** to the complete texts of both acts on the authoritative sources.
4. **Client-side search** (instant filter over title/summary/§), like the quiz.

## Implementation
- `data/docs/road_rules.json` — the curated entries (theme, §, title_cs/en, summary_cs/en, url).
- `app/templates/docs.html` (hub) + the section renderer; route `/docs` in `app/main.py`,
  passing the JSON; minimal vanilla-JS filter. Reuse the intro visual style.
- Flip the intro "Official documents" card from `soon` → live.
- Bilingual now (CS + EN); more languages can follow the quiz's 10-lang pattern later.

## Out of scope (MVP)
Full verbatim statute in-app; PDF hosting; per-language beyond CS/EN. (Follow-ups.)

## Status
- [ ] road_rules.json content (curated + verified § links)
- [ ] /docs hub + section template + route
- [ ] search filter
- [ ] intro card → live
- [ ] deploy + browser-verify + report
