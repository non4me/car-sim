# Accounts + Registration + Admin — implementation plan (msg 2775/2783)

Vlad: "займись админкой и регистрацией приоритетно" + earlier "лучше с использованием внешних сервисов".
Design source: `docs/specs/accounts-and-trips.md`. This plan is the EXECUTION of items 5+6, auth-first.

## Decisions (locked — sensible defaults, told Vlad)
- **Storage:** SQLite at `/app/var/app.db` (WAL) in a persistent docker **named volume** `carsim-data`
  (survives redeploys; rsync `--delete` never touches it; trivial backup). NOT under data/cities (that's
  baked into the image and overwritten each build).
- **Auth:** dual, pluggable —
  - **Google OAuth** (primary, his external preference) via Authlib; button shown only when
    `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env are set. First Google login auto-creates the account.
  - **Email + password** fallback (stdlib `hashlib.scrypt`, per-user salt — no fragile bcrypt dep) so the
    system is fully working + browser-verifiable TODAY without waiting on Vlad's Google client.
  - Sessions: Starlette `SessionMiddleware` (signed cookie, `itsdangerous`), `SECRET_KEY` from env.
  - **Admin:** `ADMIN_EMAILS` env (default vladimir.troyanenko@gmail.com); those emails get `role=admin`
    automatically on login/register. Vlad seeded as admin.
- **GDPR:** keep-until-delete; `/me` has data **export** (JSON download) + **delete account** (cascades);
  cookie notice for the session cookie. No email-verify in v1 (Google emails are pre-verified).
- Guests stay anonymous: `/drive` fully playable logged-out, recording only switches on when logged in.

## New deps (requirements.txt)
`authlib`, `httpx`, `itsdangerous`. (scrypt = stdlib.)

## Files
- `app/db.py` — sqlite3 connect (WAL), `init_db()` (users/trips/events schema — all created now), queries.
- `app/auth.py` — scrypt hash/verify, session get/set, `current_user`/`require_admin` deps, Authlib Google
  client, `APIRouter` with /login (page), /auth/register, /auth/login, /auth/logout, /auth/google,
  /auth/google/callback.
- templates: `login.html`, `me.html`, `admin.html`; a small user-menu partial injected into intro/drive.
- `app/main.py` — add SessionMiddleware, include auth router, `/me`, `/admin`, inject `user` into templates.
- `docker-compose.castle.yml` — add `carsim-data` named volume at `/app/var` + env (SECRET_KEY, ADMIN_EMAILS,
  GOOGLE_CLIENT_ID/SECRET, BASE_URL for the OAuth redirect).
- deploy: add `--exclude var` (defensive) — volume is docker-managed anyway.

## Phases (each: build → deploy → browser-verify → report)
1. **Foundation + auth + registration + admin (THIS phase = what Vlad asked).**
   DB+schema+seed; sessions; Google OAuth + email/password; /login, /register, /logout; user menu;
   `/me` (profile + GDPR export/delete); `/admin` (user list, role toggle, delete). Verify full flow.
2. **Trip recorder + `/me` stats** — client buffer → `POST /api/trips` (sendBeacon on stop/leave), server
   validate/store; /me violations-per-km trend, time/distance, score.
3. **Admin dashboard + `/admin/replay/<id>`** — overall counters/trends; replay mode re-drives recorded
   samples in the `/drive` renderer (play/pause/scrub/1–8×, event markers).

## Open external dependency (the one thing I can't self-provision)
Google OAuth client (client_id+secret) lives in Vlad's Google Cloud Console. Email/password works without
it; the Google button activates the moment he drops the creds into the Castle env. Will ask + offer to walk
him through the 5-min console steps (redirect URI = https://car-sim.troyanenko.com/auth/google/callback).

## Admin-grant security model (after a security-review finding)
Admin is NEVER granted from self-service email/password registration (anyone could squat the admin
address). Admin comes only from:
1. **Google-verified sign-in** whose `email_verified=true` email is in `ADMIN_EMAILS` (Vlad's real account).
2. **Out-of-band startup seed** `SEED_ADMIN_EMAIL` (+`SEED_ADMIN_PASSWORD`) — only settable by someone with
   Castle shell access; creates-or-elevates that account to admin on boot.
3. An existing admin promoting a user in `/admin`.
`google_callback` rejects unverified emails before trusting/elevating; email/password login never elevates.

## Progress / issues
- 2026-06-15: plan written; Phase 1 built (db/auth/main/templates/compose).
- 2026-06-15: security review caught email-based admin auto-grant on email/password registration (CRITICAL,
  privilege escalation). Fixed: register→role=user always; elevation only on Google-verified ADMIN_EMAILS or
  the seed; google_callback now requires email_verified. Re-verifying.
