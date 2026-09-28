import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS notifications CASCADE;
      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log("Notifications table recreated with role");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
