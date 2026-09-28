CREATE TABLE `decision_usage` (
	`owner` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
