# Spec stub — user accounts, stats & progress (feedback item 5)

> Placeholder for separate elaboration (research → analysis → spec → plan → impl). Captures scope so
> it isn't lost. Not started; the driving UX refinements come first.

## Intent
Registered users get persistent stats and progress tracking on the simulator:
- **Violations** logged (over-limit, wrong-way, ran-red, off-road, …) per trip and aggregated.
- **Time driven** (per trip, total) and distance.
- **Progress / regress** over time (e.g., violations-per-km trend, a score) shown back to the user.

## To research / decide
- Auth: own email+password vs OAuth; session model; the app is currently DB-less.
- Storage: introduce a DB (SQLite/Postgres) for users + trips + events; or a lightweight store.
- Trip model: a trip = ordered samples {t, x, y, heading, speed, segment, events}. Sample rate / size budget
  (also feeds the admin replay player, item 6 — shared data model).
- Privacy/GDPR: what is stored, retention, export/delete.
- Where stats render: a `/me` or profile section; guest play stays anonymous (no tracking).

## Dependencies
Shares the **trip-log data model** with [admin.md](admin.md) (replay player). Build the trip recorder once.
