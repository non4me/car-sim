# Admin panel + trip-replay player (feedback item 6)

**Superseded by the consolidated layer spec → [accounts-and-trips.md](accounts-and-trips.md).**

Items 5 and 6 share one foundation (trip-log model + store + auth), so they are designed together there.
Item 6 is the admin half: an `role=admin`-gated section with overall stats, user management, and a
**trip-replay player** that re-drives a recorded trip on the baked map (play/pause, scrub, variable speed,
event markers) by reusing the `/drive` renderer in playback mode. See the consolidated spec for the replay
data source, admin auth, and the build plan.
