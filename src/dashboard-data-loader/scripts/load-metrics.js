#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Config
const METRICS_JSON = process.env.METRICS_JSON || path.join(__dirname, '..', 'samples', 'metrics.json');
const SCOPE = {
  enterprise: process.env.SCOPE_ENTERPRISE || null,
  organization: process.env.SCOPE_ORG || null,
  team: process.env.SCOPE_TEAM || null,
};

function parseDate(d) {
  // Accept YYYY-MM-DD or ISO strings
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

async function main() {
  // Read file
  if (!fs.existsSync(METRICS_JSON)) {
    throw new Error(`Metrics file not found: ${METRICS_JSON}`);
  }
  const raw = fs.readFileSync(METRICS_JSON, 'utf-8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${METRICS_JSON}: ${e.message}`);
  }
  if (!Array.isArray(items)) {
    throw new Error('Expected metrics JSON to be an array of daily payloads');
  }

  const pool = new Pool();
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');

    for (const item of items) {
      const date = parseDate(item.date);
      if (!date) {
        console.warn('Skipping item without valid date:', item.date);
        continue;
      }
      // Upsert by unique index (date + scope)
      const text = `
        MERGE INTO public.metrics_history AS t
        USING (
          SELECT $1::date AS date,
                 $2::text AS enterprise,
                 $3::text AS organization,
                 $4::text AS team,
                 $5::jsonb AS payload
        ) AS s
        ON (
          t.date = s.date
          AND COALESCE(t.enterprise, '') = COALESCE(s.enterprise, '')
          AND COALESCE(t.organization, '') = COALESCE(s.organization, '')
          AND COALESCE(t.team, '') = COALESCE(s.team, '')
        )
        WHEN MATCHED THEN
          UPDATE SET payload = s.payload, created_at = now()
        WHEN NOT MATCHED THEN
          INSERT (date, enterprise, organization, team, payload)
          VALUES (s.date, s.enterprise, s.organization, s.team, s.payload);
      `;
      const values = [date, SCOPE.enterprise, SCOPE.organization, SCOPE.team, JSON.stringify(item)];
      await client.query(text, values);
      inserted += 1;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Metrics load complete. Rows upserted: ${inserted}`);
}

main().catch((err) => {
  console.error('Load failed:', err);
  process.exitCode = 1;
});
