#!/usr/bin/env node
'use strict';
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const pool = new Pool();
  try {
    const res = await pool.query('SELECT NOW() as now');
    console.log('Connected. Time:', res.rows[0].now);
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
