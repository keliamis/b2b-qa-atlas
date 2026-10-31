CREATE TABLE `defects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer NOT NULL,
	`source_run_id` text,
	`source_case_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `defects_project_idx` ON `defects` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `defect_run_case_idx` ON `defects` (`project_id`,`source_run_id`,`source_case_id`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `views_user_project_idx` ON `saved_views` (`user_id`,`project_id`);