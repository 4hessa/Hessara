CREATE TABLE `integration_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`run_id` text NOT NULL,
	`destination` text NOT NULL,
	`status` text NOT NULL,
	`external_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_export_run_destination` ON `integration_exports` (`owner`,`run_id`,`destination`);