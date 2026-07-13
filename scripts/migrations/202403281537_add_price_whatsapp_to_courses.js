import { query } from '../lib/db.js';

export async function up() {
  await query(`
    ALTER TABLE courses
    ADD COLUMN price INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN whatsapp TEXT NOT NULL DEFAULT '';
  `);
}

export async function down() {
  await query(`
    ALTER TABLE courses
    DROP COLUMN price,
    DROP COLUMN whatsapp;
  `);
}