CREATE TABLE `runbook_run` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`step_idx` integer NOT NULL,
	`bindings` text,
	`facts` text,
	`approval` text,
	`source_bundle` text,
	`pause_reason` text,
	`error` text,
	`time_started` integer,
	`time_ended` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runbook_run_session_idx` ON `runbook_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `runbook_run_message_idx` ON `runbook_run` (`message_id`);
--> statement-breakpoint
CREATE INDEX `runbook_run_status_idx` ON `runbook_run` (`status`);
--> statement-breakpoint
CREATE TABLE `runbook_step` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`step_id` text NOT NULL,
	`step_idx` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`output_preview` text,
	`vm_activity_ids` text,
	`artifacts` text,
	`error` text,
	`time_started` integer,
	`time_ended` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runbook_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runbook_step_run_idx` ON `runbook_step` (`run_id`);
--> statement-breakpoint
CREATE INDEX `runbook_step_session_idx` ON `runbook_step` (`session_id`);
--> statement-breakpoint
CREATE INDEX `runbook_step_order_idx` ON `runbook_step` (`run_id`, `step_idx`);
--> statement-breakpoint
CREATE INDEX `runbook_step_status_idx` ON `runbook_step` (`status`);
