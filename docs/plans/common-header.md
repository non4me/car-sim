# Common app header (msg 2837)

Goal: one consistent header across **all** sections with (1) login/register (or user menu),
(2) the quiz-style flag **language selector**, (3) a home **logo/icon** for the project.

## Constraints
- Sections use different stacks: plain-CSS pages (intro, docs, login, me, admin), Tailwind quiz photo
  (separate FastAPI sub-app + own Jinja env), quiz situations sub-app, and the canvas `/drive` (HUD overlay).
- So the header must be ONE source of truth that works regardless of stack → render it in **Python**
  (`app/ui.py`) and inject the HTML, rather than a Jinja `{% include %}` (paths differ across envs).

## Design
`app/ui.py` (new), modular so `/drive` can reuse pieces inside its HUD:
- `LANGS` (10, code/native/cc) — same set as the quiz; `SUPPORTED`.
- `HSTR` — header strings per lang: login / register / profile / logout / admin.
- `resolve_lang(request, default="cs")` = `?lang=` → cookie `carsim_lang` → default (clamped).
- `LOGO_SVG` — brand mark: top-down car (the sim's own motif) on an accent badge + "car-sim" wordmark.
- `assets()` → `<style>` (scoped `.ah-*`) + `<script>` (dropdown toggle + lang-switch: rebuild current URL
  with new `?lang=`, set cookie, reload). Include once per page.
- `logo(home="/")`, `lang_dropdown(lang)`, `user_menu(lang, user)` — sub-components.
- `header(lang, user)` = assets + `<header class="ah">` logo · spacer · lang_dropdown · user_menu.

Flags: copy `app/quiz/static/flags/*.svg` → `app/static/flags/` so they serve app-wide at `/static/flags/<cc>.svg`.

## Wiring
- Expose `ui` module as a Jinja global on the main env AND the two sub-app envs.
- Pages call `{{ ui.header(lang, user) }}` at top of `<body>`: intro, quiz hub, docs, docs_law, login, me, admin,
  quiz/photo base.html (replace its bespoke header), quiz/situations index.html.
- `/drive`: keep the HUD topbar but swap "← car-sim" for `ui.logo()` and add `ui.lang_dropdown` + `ui.user_menu`
  on the right; include `ui.assets()` in <head>.
- Routes resolve `lang = ui.resolve_lang(request)` and pass it (intro/quiz/drive didn't before).
- Localize **intro** content to `lang` (small string set). Docs + quiz already localize. `/drive` HUD strings
  staying Czech for now = follow-up (note it).

## Verify
Browser-screenshot intro + docs + quiz + drive in cs and one other lang; confirm logo→home, lang switch
persists across sections (cookie), login/register shows when logged out, user menu when logged in.
