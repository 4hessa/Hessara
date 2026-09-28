CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`config` text NOT NULL,
	`total` integer NOT NULL,
	`next_index` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`locked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_owner_created` ON `runs` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `trials` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model` text NOT NULL,
	`task_id` text NOT NULL,
	`repeat` integer NOT NULL,
	`status` text NOT NULL,
	`score` real,
	`output` text,
	`latency` real,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost` real,
	`error` text,
	`metadata` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trials_run_model_task_repeat` ON `trials` (`run_id`,`model`,`task_id`,`repeat`);