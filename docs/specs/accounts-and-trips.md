# Spec — accounts, trip logging, stats & admin replay (feedback items 5 + 6)

> Consolidated "separate elaboration" Vlad asked for (msg 2663 items 5/6). Items 5 (user accounts +
> stats/progress) and 6 (admin panel + trip-replay player) are **one layer**: they share a trip-log data
> model, a store, and an auth model. Build that foundation once. This is a design proposal — code not
> started; flagged **[DECIDE]** points need Vlad's call before implementation.

## 1. Why one layer
- Item 5 needs: who the user is (auth), and per-user **trips** + **violation events** to compute stats.
- Item 6 needs: the same **trips** (to replay) + the same **events** (timeline markers) + an admin role.
- So the spine is a single **trip recorder** writing a `trip` (sampled vehicle states) + `events`
  (violations), persisted against a `user`. Everything else (stats page, admin dashboard, replay) is a
  read view over that spine.

## 2. Data model
```
user    (id, email, pw_hash, display_name, role['user'|'admin'], created_at, locale)
trip    (id, user_id, city, district, started_at, ended_at, distance_m, duration_s,
         n_violations, summary_json)            -- one driving session
sample  (trip_id, t_ms, x, y, heading, speed)   -- vehicle state, ~5 Hz (see budget)
event   (id, trip_id, t_ms, kind, x, y, meta)   -- kind: over_limit|wrong_way|ran_red|stop|off_road|boundary
```
- **Trip = ordered samples + events over the baked map.** Replay (item 6) re-drives the samples; stats
  (item 5) aggregate events + duration/distance. Same rows feed both — no duplication.
- **Sample budget:** at 5 Hz a 10-min trip ≈ 3000 samples × ~5 numbers. Store **deltas + downsample**
  (drop samples while heading/speed are ~constant; keep corners + event-adjacent). Target < ~50 KB/trip.
  Replay interpolates between kept samples. [DECIDE] exact rate — 5 Hz proposed.

## 3. Storage  — [DECIDE]
Recommend **SQLite** (file under `/opt/car-sim/data/app.db`, WAL): the app is single-container, traffic is
low, zero new infra, trivial backup. Migrate to Postgres only if multi-instance later. (Alt: Postgres now if
Vlad wants it shared with other Castle services.) Samples stored as a compact JSON/array blob on `trip`
rather than a `sample` table — simpler, one row per trip, fine for replay. Events stay relational for queries.

## 4. Auth  — [DECIDE]
- **Recommend:** own **email + password** (argon2/bcrypt), signed-cookie session (`itsdangerous` / Starlette
  `SessionMiddleware`), email-verify optional v1. No third-party dependency, fits the DB-less→DB move.
- **Alt:** OAuth (Google) — less password handling, but adds a provider dependency + redirect setup.
- **Guests stay anonymous:** `/drive` is fully playable logged-out with **no tracking**; recording only
  switches on when logged in. A guest can opt to "save this trip" → prompt to register.
- Admin = `role='admin'` on the user row (Vlad's account seeded as admin). Routes gated by a dependency.

## 5. Violation detection (where events come from)
The rules engine (`rules/limits.js`) already computes per-frame `{over, offRoad, boundary, limit, …}`. The
recorder debounces these into discrete **events** (enter/exit, not per-frame) and timestamps them. New kinds
(`wrong_way` from oneway + heading, `ran_red`/`stop` from junction control state) come with the Phase-6 rules
work — the recorder is forward-compatible (event `kind` is open). v1 can ship with `over_limit`, `off_road`,
`boundary` (all already detected) and add the rest as rules land.

## 6. Surfaces
- **`/me`** (logged-in): per-trip list + a progress view — violations-per-km trend, total time/distance, a
  simple score. Charts client-side from a small JSON API. [DECIDE] which metrics matter most to Vlad.
- **Recorder:** client samples `window.__drive` state + rule events into a buffer; flush to
  `POST /api/trips` on stop/leave (sendBeacon). Server validates + stores.
- **`/admin`** (role=admin): overall counters + trends; user list/search → a user's trips; disable/delete a
  user (GDPR). 
- **`/admin/replay/<trip_id>`:** reuse the `/drive` renderer in **playback mode** — feed it the recorded
  samples instead of live input (the engine already separates state from input; a `replaySource` drives
  `car.x/y/heading/v`). Controls: play/pause, scrub, **variable speed (1×–8×)**, event markers on a timeline.

## 7. GDPR / privacy  — [DECIDE]
- Store only what stats need (no precise real-world identity beyond email). Trips are in-game coordinates.
- **Export** (user downloads their data) + **delete account** (cascades trips/events). Retention default:
  keep until user deletes. Cookie/consent notice for the session cookie. [DECIDE] retention window, if any.

## 8. Build plan (after Vlad approves §3/§4/§7)
1. Add SQLite + models + migrations; seed Vlad as admin. (no UI yet)
2. Auth: register/login/logout, session, `current_user` dependency, guest-safe `/drive`.
3. Trip recorder (client buffer → `POST /api/trips`) + server validation/store. Verify a round-trip.
4. `/me` stats (API + minimal charts).
5. `/admin` dashboard + user management.
6. Replay mode in the renderer + `/admin/replay/<id>` player.
Each step independently testable; 1–3 are the foundation both items stand on.

## Open decisions for Vlad (blockers before code)
1. **Storage:** SQLite (recommended) vs Postgres?
2. **Auth:** own email+password (recommended) vs Google OAuth?
3. **Privacy:** retention window + is email-verify needed in v1?
4. **Priority:** build this now, or expand the sim to **all-Prague** first? (item 5/6 are marked secondary;
   the sim is the flagship.)
