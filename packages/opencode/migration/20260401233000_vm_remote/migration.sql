ALTER TABLE `vm` ADD `cache_root` text;
--> statement-breakpoint
ALTER TABLE `vm` ADD `max_concurrency` integer;
--> statement-breakpoint
ALTER TABLE `vm` ADD `weight` integer;
--> statement-breakpoint
ALTER TABLE `vm` ADD `retry_count` integer;
--> statement-breakpoint
ALTER TABLE `vm` ADD `retry_backoff_secs` integer;
--> statement-breakpoint
ALTER TABLE `runbook_run` ADD `handles` text;
--> statement-breakpoint
CREATE TABLE `vm_remote_session` (
	`id` text PRIMARY KEY NOT NULL,
	`vm_id` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`workspace_dir` text NOT NULL,
	`workspace_ref` text NOT NULL,
	`workspace_repo` text NOT NULL,
	`base_ref` text NOT NULL,
	`last_sync_hash` text,
	`last_sync_at` integer,
	`runtime` text NOT NULL,
	`worker_version` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`vm_id`) REFERENCES `vm`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vm_remote_session_vm_idx` ON `vm_remote_session` (`vm_id`);
--> statement-breakpoint
CREATE INDEX `vm_remote_session_session_idx` ON `vm_remote_session` (`session_id`);
--> statement-breakpoint
CREATE INDEX `vm_remote_session_status_idx` ON `vm_remote_session` (`status`);
--> statement-breakpoint
CREATE TABLE `vm_job` (
	`id` text PRIMARY KEY NOT NULL,
	`vm_session_id` text NOT NULL,
	`vm_id` text NOT NULL,
	`status` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text,
	`pid` integer,
	`started_at` integer,
	`ended_at` integer,
	`exit_code` integer,
	`log_dir` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`vm_session_id`) REFERENCES `vm_remote_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vm_id`) REFERENCES `vm`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vm_job_session_idx` ON `vm_job` (`vm_session_id`);
--> statement-breakpoint
CREATE INDEX `vm_job_vm_idx` ON `vm_job` (`vm_id`);
--> statement-breakpoint
CREATE INDEX `vm_job_status_idx` ON `vm_job` (`status`);
