-- EverThere initial schema. Keep in exact sync with src/db/schema.ts (enforced by test/schema-sync.test.ts).
-- Timestamps are integer epoch milliseconds. JSON columns are TEXT. Booleans are INTEGER 0/1.

CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `avatar_emoji` text,
  `created_at` integer NOT NULL,
  `is_demo` integer DEFAULT 0 NOT NULL
);

CREATE TABLE `org` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `logo_key` text,
  `address` text,
  `timezone` text DEFAULT 'UTC' NOT NULL
);

CREATE TABLE `org_member` (
  `org_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL,
  PRIMARY KEY (`org_id`, `user_id`)
);

CREATE TABLE `family` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `family_member` (
  `family_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text DEFAULT 'parent' NOT NULL,
  PRIMARY KEY (`family_id`, `user_id`)
);

CREATE TABLE `child` (
  `id` text PRIMARY KEY NOT NULL,
  `family_id` text NOT NULL,
  `name` text NOT NULL,
  `photo_key` text,
  `birthday` text,
  `timezone` text DEFAULT 'UTC' NOT NULL
);
CREATE INDEX `child_family_idx` ON `child` (`family_id`);

CREATE TABLE `avatar` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `napster_companion_id` text,
  `napster_agent_id` text,
  `voice_id` text,
  `photo_key` text,
  `status` text DEFAULT 'creating' NOT NULL,
  `approved_at` integer,
  `consent_name` text,
  `consent_at` integer,
  `is_synthetic` integer DEFAULT 0 NOT NULL
);
CREATE INDEX `avatar_user_idx` ON `avatar` (`user_id`);

CREATE TABLE `comfort_plan` (
  `child_id` text NOT NULL,
  `avatar_id` text NOT NULL,
  `parent_title` text NOT NULL,
  `nicknames` text DEFAULT '[]' NOT NULL,
  `tone` text DEFAULT 'calm' NOT NULL,
  `favorites` text DEFAULT '[]' NOT NULL,
  `phrases` text DEFAULT '[]' NOT NULL,
  `song_title` text,
  `song_lyrics` text,
  `never_topics` text DEFAULT '[]' NOT NULL,
  `today_note` text,
  `today_note_expires_at` integer,
  PRIMARY KEY (`child_id`, `avatar_id`)
);

CREATE TABLE `connection` (
  `id` text PRIMARY KEY NOT NULL,
  `child_id` text NOT NULL,
  `kind` text NOT NULL,
  `org_id` text,
  `caregiver_user_id` text,
  `transcript_access` integer DEFAULT 0 NOT NULL
);
CREATE INDEX `connection_child_idx` ON `connection` (`child_id`);
CREATE INDEX `connection_caregiver_idx` ON `connection` (`caregiver_user_id`);

CREATE TABLE `classroom` (
  `id` text PRIMARY KEY NOT NULL,
  `org_id` text NOT NULL,
  `name` text NOT NULL,
  `emoji` text
);
CREATE INDEX `classroom_org_idx` ON `classroom` (`org_id`);

CREATE TABLE `classroom_child` (
  `classroom_id` text NOT NULL,
  `child_id` text NOT NULL,
  PRIMARY KEY (`classroom_id`, `child_id`)
);

CREATE TABLE `classroom_staff` (
  `classroom_id` text NOT NULL,
  `user_id` text NOT NULL,
  PRIMARY KEY (`classroom_id`, `user_id`)
);

CREATE TABLE `staff_pin` (
  `user_id` text NOT NULL,
  `org_id` text NOT NULL,
  `pin_hash` text NOT NULL,
  PRIMARY KEY (`user_id`, `org_id`)
);

CREATE TABLE `invite_code` (
  `code` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `payload` text DEFAULT '{}' NOT NULL,
  `created_by` text NOT NULL,
  `expires_at` integer NOT NULL,
  `used_by` text,
  `used_at` integer
);

CREATE TABLE `comfort_session` (
  `id` text PRIMARY KEY NOT NULL,
  `napster_session_id` text,
  `child_id` text,
  `avatar_id` text NOT NULL,
  `caregiver_user_id` text NOT NULL,
  `org_id` text,
  `reason` text,
  `started_at` integer NOT NULL,
  `ended_at` integer,
  `duration_s` integer,
  `cost_usd` real,
  `mood_after` text,
  `caregiver_note` text,
  `summary` text,
  `mood_signal` text,
  `status` text DEFAULT 'active' NOT NULL,
  `kind` text DEFAULT 'child' NOT NULL,
  `transcript_json` text,
  `napster_status` text,
  `ended_reason` text
);
CREATE INDEX `comfort_session_child_idx` ON `comfort_session` (`child_id`);
CREATE INDEX `comfort_session_napster_idx` ON `comfort_session` (`napster_session_id`);
CREATE INDEX `comfort_session_status_idx` ON `comfort_session` (`status`);

CREATE TABLE `session_flag` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `source` text NOT NULL,
  `category` text NOT NULL,
  `quote` text,
  `severity` text NOT NULL,
  `created_at` integer NOT NULL,
  `acknowledged_by` text,
  `acknowledged_at` integer
);
CREATE INDEX `session_flag_session_idx` ON `session_flag` (`session_id`);

CREATE TABLE `alert` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `kind` text NOT NULL,
  `ref_id` text,
  `title` text NOT NULL,
  `body` text,
  `read_at` integer,
  `created_at` integer NOT NULL
);
CREATE INDEX `alert_user_idx` ON `alert` (`user_id`, `created_at`);

CREATE TABLE `usage_ledger` (
  `day` text PRIMARY KEY NOT NULL,
  `minutes` real DEFAULT 0 NOT NULL,
  `cost_usd` real DEFAULT 0 NOT NULL
);

CREATE TABLE `webhook_event` (
  `event_id` text PRIMARY KEY NOT NULL,
  `received_at` integer NOT NULL
);

CREATE TABLE `enrollment` (
  `id` text PRIMARY KEY NOT NULL,
  `org_id` text NOT NULL,
  `classroom_id` text NOT NULL,
  `child_name` text NOT NULL,
  `invite_code` text NOT NULL,
  `child_id` text,
  `status` text DEFAULT 'invited' NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX `enrollment_org_idx` ON `enrollment` (`org_id`);

CREATE TABLE `device` (
  `id` text PRIMARY KEY NOT NULL,
  `org_id` text NOT NULL,
  `registered_by` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `pin_attempt` (
  `device_id` text NOT NULL,
  `at` integer NOT NULL
);
CREATE INDEX `pin_attempt_device_idx` ON `pin_attempt` (`device_id`, `at`);

CREATE TABLE `credit_guard` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `cap_usd` real DEFAULT 120 NOT NULL,
  `spent_usd` real DEFAULT 0 NOT NULL
);
INSERT INTO `credit_guard` (`id`, `cap_usd`, `spent_usd`) VALUES (1, 120, 0);
