-- Task 15: demo world + judge access.
-- rate_limit: fixed one-minute windows per key (e.g. "demo-sign-in:<ip>"), incremented atomically with an upsert.
CREATE TABLE `rate_limit` (
  `key` text NOT NULL,
  `window_start` integer NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (`key`, `window_start`)
);

-- demo_persona: which seeded Clerk user the "Try the demo" sheet signs in as (written by PUT /api/admin/seed).
CREATE TABLE `demo_persona` (
  `persona` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL
);

-- demo_fixture: the single stored seed fixture (JSON) the nightly reset restores; seeded_at anchors "created after".
CREATE TABLE `demo_fixture` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `json` text NOT NULL,
  `seeded_at` integer NOT NULL
);
