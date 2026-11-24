CREATE TABLE `pos_cash_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `pos_cash_shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pos_cash_movements_shift_id` ON `pos_cash_movements` (`shift_id`);--> statement-breakpoint
CREATE TABLE `pos_cash_shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_by_user_id` integer NOT NULL,
	`opened_by_name` text NOT NULL,
	`opening_amount` integer DEFAULT 0 NOT NULL,
	`cash_sales` integer DEFAULT 0 NOT NULL,
	`cash_entries` integer DEFAULT 0 NOT NULL,
	`cash_outs` integer DEFAULT 0 NOT NULL,
	`opened_at` text NOT NULL,
	`closed_by_user_id` integer,
	`closed_by_name` text,
	`counted_amount` integer,
	`expected_amount` integer,
	`difference` integer,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pos_cash_shifts_single_open` ON `pos_cash_shifts` (`status`) WHERE "pos_cash_shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX `idx_pos_cash_shifts_opened_at` ON `pos_cash_shifts` (`opened_at`);--> statement-breakpoint
PRAGMA optimize;
