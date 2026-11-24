import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  salePrice: integer('sale_price').notNull(),
  stock: integer('stock').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const repairOrders = sqliteTable('repair_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  deviceBrand: text('device_brand').notNull(),
  deviceModel: text('device_model').notNull(),
  serialNumber: text('serial_number'),
  reportedIssue: text('reported_issue').notNull(),
  status: text('status').notNull().default('received'),
  estimatedTotal: integer('estimated_total').notNull().default(0),
  deposit: integer('deposit').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  total: integer('total').notNull(),
  paymentMethod: text('payment_method').notNull(),
  createdAt: text('created_at').notNull(),
});

export const posUsers = sqliteTable('pos_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  permissions: text('permissions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const posSessions = sqliteTable('pos_sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const posNotifications = sqliteTable('pos_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  severity: text('severity').notNull().default('info'),
  message: text('message').notNull(),
  actorName: text('actor_name').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  details: text('details').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
});

export const posCashShifts = sqliteTable('pos_cash_shifts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status').notNull().default('open'),
  openedByUserId: integer('opened_by_user_id').notNull(),
  openedByName: text('opened_by_name').notNull(),
  openingAmount: integer('opening_amount').notNull().default(0),
  cashSales: integer('cash_sales').notNull().default(0),
  cashEntries: integer('cash_entries').notNull().default(0),
  cashOuts: integer('cash_outs').notNull().default(0),
  openedAt: text('opened_at').notNull(),
  closedByUserId: integer('closed_by_user_id'),
  closedByName: text('closed_by_name'),
  countedAmount: integer('counted_amount'),
  expectedAmount: integer('expected_amount'),
  difference: integer('difference'),
  closedAt: text('closed_at'),
}, table => [
  uniqueIndex('idx_pos_cash_shifts_single_open').on(table.status).where(sql`${table.status} = 'open'`),
  index('idx_pos_cash_shifts_opened_at').on(table.openedAt),
]);

export const posCashMovements = sqliteTable('pos_cash_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shiftId: integer('shift_id').notNull().references(() => posCashShifts.id),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  actorName: text('actor_name').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('idx_pos_cash_movements_shift_id').on(table.shiftId)]);
