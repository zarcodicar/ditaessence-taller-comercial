ALTER TABLE `pos_notifications` ADD `severity` text NOT NULL DEFAULT 'info';
ALTER TABLE `pos_notifications` ADD `entity_type` text;
ALTER TABLE `pos_notifications` ADD `entity_id` text;
ALTER TABLE `pos_notifications` ADD `details` text NOT NULL DEFAULT '{}';
