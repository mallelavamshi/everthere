-- Avatar keeps the parent's chosen title (default for new comfort plans) and its creation time (30-minute creation timeout).
ALTER TABLE `avatar` ADD `parent_title` text DEFAULT '' NOT NULL;
ALTER TABLE `avatar` ADD `created_at` integer DEFAULT 0 NOT NULL;
