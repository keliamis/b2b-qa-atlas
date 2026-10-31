CREATE INDEX `comments_project_idx` ON `comments` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_idx` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_project_idx` ON `invitations` (`project_id`);