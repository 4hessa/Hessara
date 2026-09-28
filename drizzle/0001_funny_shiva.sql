CREATE TABLE `model_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`key_cipher` text NOT NULL,
	`input_price` real,
	`output_price` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_profiles_owner` ON `model_profiles` (`owner`);