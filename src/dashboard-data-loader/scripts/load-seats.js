#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Config
const SEATS_JSON = process.env.SEATS_JSON || path.join(__dirname, '..', 'samples', 'seats.json');
const PAGE = Number(process.env.SEATS_PAGE || '1');
const HAS_NEXT_PAGE = String(process.env.SEATS_HAS_NEXT_PAGE || 'false').toLowerCase() === 'true';
const SCOPE = {
  enterprise: process.env.SCOPE_ENTERPRISE || null,
  organization: process.env.SCOPE_ORG || null,
};

function inferDateFromSeats(seatsObj) {
  // Try to infer date from any timestamp fields; fallback to today
  const timestamps = [];
  if (seatsObj && Array.isArray(seatsObj.seats)) {
    for (const s of seatsObj.seats) {
      if (s && s.updated_at) timestamps.push(s.updated_at);
      if (s && s.created_at) timestamps.push(s.created_at);
      if (s && s.last_activity_at) timestamps.push(s.last_activity_at);
    }
  }
  const dt = timestamps.length ? new Date(timestamps.sort()[0]) : new Date();
  if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  if (!fs.existsSync(SEATS_JSON)) {
    throw new Error(`Seats file not found: ${SEATS_JSON}`);
  }
  const raw = fs.readFileSync(SEATS_JSON, 'utf-8');
  let seats;
  try {
    seats = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${SEATS_JSON}: ${e.message}`);
  }
  if (!seats || typeof seats !== 'object' || !Array.isArray(seats.seats)) {
    throw new Error('Expected seats JSON to be an object with array property "seats"');
  }

  const date = inferDateFromSeats(seats);
  const totalSeats = Number(seats.total_seats || seats.seats.length || 0);
  const totalActive = seats.seats.filter((s) => Boolean(s && s.last_activity_at)).length;

  const pool = new Pool();
  const client = await pool.connect();
  try {
    const text = `
      MERGE INTO public.seats_history AS t
      USING (
        SELECT $1::date AS date,
               $2::text AS enterprise,
               $3::text AS organization,
               $4::int AS page,
               $5::jsonb AS seats,
               $6::int AS total_seats,
               $7::int AS total_active_seats,
               $8::boolean AS has_next_page
      ) AS s
      ON (
        t.date = s.date
        AND COALESCE(t.enterprise, '') = COALESCE(s.enterprise, '')
        AND COALESCE(t.organization, '') = COALESCE(s.organization, '')
        AND COALESCE(t.page, 1) = COALESCE(s.page, 1)
      )
      WHEN MATCHED THEN UPDATE SET
        seats = s.seats,
        total_seats = s.total_seats,
        total_active_seats = s.total_active_seats,
        has_next_page = s.has_next_page,
        last_update = NOW()
      WHEN NOT MATCHED THEN INSERT
        (date, enterprise, organization, page, seats, total_seats, total_active_seats, has_next_page, last_update)
      VALUES
        (s.date, s.enterprise, s.organization, s.page, s.seats, s.total_seats, s.total_active_seats, s.has_next_page, NOW());
    `;
    const values = [
      date,
      SCOPE.enterprise,
      SCOPE.organization,
      PAGE,
      JSON.stringify(seats.seats),
      totalSeats,
      totalActive,
      HAS_NEXT_PAGE,
    ];
    const r = await client.query(text, values);
    console.log('Seats upserted for', { date, page: PAGE, totalSeats, totalActive, hasNextPage: HAS_NEXT_PAGE });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Load failed:', err);
  process.exitCode = 1;
});
