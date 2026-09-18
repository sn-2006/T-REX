import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set — copy server/.env.example to server/.env and fill it in."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Idle client errors (e.g. connection dropped) — don't crash the process.
  console.error("[db] Unexpected error on idle client", err);
});
