import { Pool, PoolClient } from "pg";
import { stringIsNullOrEmpty } from "../utils/helpers";

// Global connection pool
let globalPool: Pool | null = null;

export const postgresClient = (): Pool => {
  if (globalPool) {
    return globalPool;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (stringIsNullOrEmpty(connectionString)) {
    throw new Error("Missing required environment variable for PostgreSQL connection string");
  }

  globalPool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  return globalPool;
};

export const postgresConfiguration = (): boolean => {
  const connectionString = process.env.DATABASE_URL;
  
  return (
    connectionString !== undefined &&
    connectionString.trim() !== ""
  );
};

export const closePostgresConnection = async (): Promise<void> => {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
};

// Helper function to execute queries with proper error handling
export const executeQuery = async <T>(
  query: string,
  params: any[] = []
): Promise<T[]> => {
  const pool = postgresClient();
  const client: PoolClient = await pool.connect();
  
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
};

// Helper function for single query execution with transaction support
export const executeTransaction = async <T>(
  queries: Array<{ query: string; params: any[] }>
): Promise<T[][]> => {
  const pool = postgresClient();
  const client: PoolClient = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const results: T[][] = [];
    for (const { query, params } of queries) {
      const result = await client.query(query, params);
      results.push(result.rows);
    }
    
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};