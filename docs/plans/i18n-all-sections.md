# Full-app i18n — localize every section to the header language (msgs 3080 / 3081 / 3083)

## Problem
The header language switcher (`?lang=` / `carsim_lang` cookie, 10 langs cs/en/ru/uk/sk/vi/de/pl/kk/ro) only
drove the **home page** and the **official documents** (laws). Everything else shipped with strings hard-coded in
Czech/English in templates and in the canvas drive-engine JS, so switching the header did nothing to:
- the quiz hub (`/quiz`)
- the drive HUD (`/drive`): street search, route panel, hints, pause, minimap, the violation warnings
- `/login`, `/me`
- the situation simulator (`/quiz/situations`): on-canvas buttons, freeze-and-explain verdicts + rule citations

Vlad: «язык влияет только на официальные документы, нужно починить остальные разделы».

## Approach
One per-language string bundle, generated once, reused by both the server templates and the client JS.

1. **`tools/translate_ui.py`** — EN base + an authored CS dict (154 keys: `q_* d_* w_* k_* sign_* poi_*
   area_* cls_* hov_* l_* me_* sim_* reason_* rule_*`). Runs each string through the **same Gemini pipeline as
   the laws** (`translate_laws.translate_strings(strings, lang, key)`) → writes `data/i18n/app.json`
   (10 langs × 154 strings). No new translation infra — reuse the laws pipeline (root-cause: one translator).
2. **`app/ui.py` → `app_strings(lang)`** loads `data/i18n/app.json`. Placed in `ui.py` (not `main.py`) so
   `auth.py` can use it for the login page without a circular import.
3. **Server templates** (`quiz.html`, `drive.html`, `login.html`, `me.html`, situations `index.html`,
   `intro.html`) take a `t` dict and render `{{ t.* }}` instead of literals. Routes in `main.py` / `auth.py` /
   situations `__init__.py` pass `t = app_strings(lang)`.
4. **Canvas drive-engine** can't read Jinja, so `drive.html` injects
   `window.CARSIM = { …, lang, i18n: {{ i18n_json|safe }} }` and a tiny `static/drive/i18n.js` exposes
   `T(key, fallback)` reading `window.CARSIM.i18n`. HUD/hover/search/minimap/main import `T`.
5. **Situations sub-app** gets `window.SIM_LANG` + `window.SIM_I18N = { str, reason, rules }`; its `i18n.js`
   was rewritten to consume that payload while still exporting `STR[lang]` / `REASON[lang][k]` /
   `RULES[key][lang]` so `game.js` is unchanged. CS/EN fallback kept inline for missing keys / stale cache.

## Gotcha that cost the most time — stale nested ES-modules behind Cloudflare
Editing `static/js/i18n.js` had no effect on prod for up to 4h: Cloudflare served the cached module
(`max-age=14400`, `cf-cache-status: HIT`). A query-string cache-buster on the `<script src>` does **not** help —
it can't reach the *nested* `import "./i18n.js"`. Fix mirrors the main app: version the whole static tree behind
a **path prefix** `/s/<build>/` (build = sha1 of newest mtime). The situations sub-app now mounts
`sim_app.mount(f"/s/{SIM_BUILD}", …)` and `index.html` loads `{{ base }}/s/{{ build }}/js/game.js`, so a deploy
busts `game.js` **and** its `./i18n.js` together. Principle: *a query string can't bust nested imports; a path
prefix does.*

## Verification (prod, ?lang=ru & ?lang=de)
Body-cyrillic audit with `?lang=ru` (chars were 0 before): `/quiz` 491, `/quiz/situations/` 1166, `/drive` 4152,
`/login` 295, home 463, `/docs` 1655. Situations payload at runtime:
`{"gasBtn":"ВПЕРЕД ▶","retryBtn":"Попробовать снова","menuBtn":"← Меню","nextBtn":"Далее ▶","scoreLbl":"Счет","scenarios":8}`.
No console errors on any page.

## Commits
- `b6d453f` — quiz hub + drive HUD localized (`app.json`, `app_strings`, `T()` helper, drive injection)
- `1591334` — login + me localized
- `ffec824` — situation simulator localized **and** its static version-busted (`/s/<build>/`)

## Follow-ups / notes
- New user-facing string ⇒ add the EN/CS key in `tools/translate_ui.py`, re-run it (needs `GEMINI_API_KEY`,
  pulled transiently from Castle `/opt/english-trainer/.env`), commit the regenerated `data/i18n/app.json`.
- The inline CS/EN fallback in `static/drive/i18n.js` and situations `i18n.js` covers a missing key or an
  old cached bundle, so the UI never renders a raw key.
