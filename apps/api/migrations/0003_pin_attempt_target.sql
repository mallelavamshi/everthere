-- PIN lockout also counts wrong PINs per target teacher (org_id, teacher_user_id) across devices.
-- Nullable: rows written before this migration have no target and count only toward their device.
ALTER TABLE `pin_attempt` ADD `org_id` text;
ALTER TABLE `pin_attempt` ADD `teacher_user_id` text;
CREATE INDEX `pin_attempt_target_idx` ON `pin_attempt` (`org_id`, `teacher_user_id`, `at`);
