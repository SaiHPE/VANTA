CREATE TABLE `vm` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`hostname` text,
	`ip` text,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`password` text,
	`private_key` text,
	`passphrase` text,
	`notes` text,
	`os_name` text,
	`os_version` text,
	`kernel` text,
	`arch` text,
	`shell` text,
	`home_dir` text,
	`last_status` text NOT NULL,
	`last_seen_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vm_project_idx` ON `vm` (`project_id`);
--> statement-breakpoint
CREATE INDEX `vm_name_idx` ON `vm` (`name`);
--> statement-breakpoint
CREATE INDEX `vm_hostname_idx` ON `vm` (`hostname`);
--> statement-breakpoint
CREATE INDEX `vm_ip_idx` ON `vm` (`ip`);
--> statement-breakpoint
CREATE TABLE `vm_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`vm_id` text NOT NULL,
	`session_id` text,
	`message_id` text,
	`part_id` text,
	`tool` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`exit_code` integer,
	`transcript` text,
	`artifacts` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`vm_id`) REFERENCES `vm`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vm_activity_vm_idx` ON `vm_activity` (`vm_id`);
--> statement-breakpoint
CREATE INDEX `vm_activity_session_idx` ON `vm_activity` (`session_id`);
--> statement-breakpoint
CREATE INDEX `vm_activity_message_idx` ON `vm_activity` (`message_id`);
--> statement-breakpoint
CREATE INDEX `vm_activity_started_idx` ON `vm_activity` (`started_at`);
