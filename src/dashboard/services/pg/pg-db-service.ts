import { stringIsNullOrEmpty } from "../../utils/helpers";
import { Pool } from "pg";

let _pool: Pool | null = null;

export const pgPool = () => {
  const connectionString = process.env.DATABASE_URL;

  if (stringIsNullOrEmpty(connectionString)) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  if (_pool) return _pool;

  // Allow optional SSL via PGSSLMODE=require (useful for managed DBs)
  const useSsl = process.env.PGSSLMODE === "require";

  _pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  return _pool;
};

export const pgConfiguration = (): boolean => {
  const connectionString = process.env.DATABASE_URL;

  return connectionString !== undefined && connectionString.trim() !== "";
};
