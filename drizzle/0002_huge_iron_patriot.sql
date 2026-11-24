CREATE TABLE `pos_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
