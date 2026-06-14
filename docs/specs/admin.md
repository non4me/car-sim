# Spec stub — admin panel + trip-replay player (feedback item 6)

> Placeholder for separate elaboration (research → analysis → spec → plan → impl). Captures scope so
> it isn't lost. Not started; depends on the accounts/trip-log layer ([accounts.md](accounts.md)).

## Intent
An admin section (auth-gated) with:
- **Overall statistics:** users, trips, violations, time/distance, trends.
- **User management:** list/search users, view a user's history, disable/delete.
- **Trip-replay player:** pick a recorded trip and replay it on the map as a player — play/pause,
  scrub, and **variable speed-up** — re-driving the logged trip {position, heading, speed, events}
  over the baked map, with violation markers on the timeline.

## To research / decide
- Reuse the `/drive` renderer in a "playback" mode driven by a recorded trip instead of live input.
- Trip-log format + storage (shared with [accounts.md](accounts.md)).
- Admin auth (role on the user model) + access control.
- Aggregation queries / dashboard widgets.

## Dependencies
Requires the trip recorder + storage from [accounts.md](accounts.md). The player reuses the sim
renderer with a recorded-input/state source.
