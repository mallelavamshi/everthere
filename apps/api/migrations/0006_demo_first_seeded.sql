-- Earliest seed time across re-seeds: the nightly reset's "created after" cutoff, so re-seeding never moves it later.
-- Nullable: when unset, demo_fixture.seeded_at is the cutoff.
ALTER TABLE `demo_fixture` ADD `first_seeded_at` integer;
