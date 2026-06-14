# User accounts, stats & progress (feedback item 5)

**Superseded by the consolidated layer spec → [accounts-and-trips.md](accounts-and-trips.md).**

Items 5 (accounts + stats/progress) and 6 (admin + trip-replay) share one foundation — a trip-log data
model, a store, and an auth model — so they are designed together there. Item 5 is the user-facing half:
registration/login, per-user trips + violation events, and a `/me` progress view (violations-per-km trend,
time/distance, score). See the consolidated spec for the data model, auth/storage choices, GDPR, and the
build plan. Open decisions (storage, auth, privacy, priority) are flagged there for Vlad.
