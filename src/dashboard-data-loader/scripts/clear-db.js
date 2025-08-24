#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    console.log('Clearing tables: seats_history, metrics_history');
    await client.query('BEGIN');
    // Use TRUNCATE with CASCADE to handle potential FKs in future
    await client.query('TRUNCATE TABLE public.seats_history RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE public.metrics_history RESTART IDENTITY CASCADE');
    await client.query('COMMIT');
    console.log('Database cleared.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to clear database:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
