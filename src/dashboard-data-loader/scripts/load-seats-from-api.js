#!/usr/bin/env node
'use strict';

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// GitHub API config
const GH = {
  enterprise: process.env.GITHUB_ENTERPRISE,
  organization: process.env.GITHUB_ORGANIZATION,
  token: process.env.GITHUB_TOKEN,
  version: process.env.GITHUB_API_VERSION || '2022-11-28',
  scope: process.env.GITHUB_API_SCOPE || 'organization',
};

const PER_PAGE = Number(process.env.PER_PAGE || 100);
const RUN_DATE = process.env.DATE || new Date().toISOString().slice(0, 10);

function ghHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GH.token}`,
    'X-GitHub-Api-Version': GH.version,
  };
}

function assertEnv() {
  const errs = [];
  if (!GH.token) errs.push('GITHUB_TOKEN');
  if (!GH.version) errs.push('GITHUB_API_VERSION');
  if (GH.scope !== 'enterprise' && GH.scope !== 'organization') {
    errs.push('GITHUB_API_SCOPE must be enterprise or organization');
  }
  if (GH.scope === 'enterprise' && !GH.enterprise) errs.push('GITHUB_ENTERPRISE');
  if (GH.scope === 'organization' && !GH.organization) errs.push('GITHUB_ORGANIZATION');
  if (errs.length) throw new Error(`Missing/invalid env: ${errs.join(', ')}`);
}

function buildSeatsUrl(page) {
  const base = GH.scope === 'enterprise'
    ? `https://api.github.com/enterprises/${GH.enterprise}/copilot/billing/seats`
    : `https://api.github.com/orgs/${GH.organization}/copilot/billing/seats`;
  const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
  return `${base}?${qs.toString()}`;
}

function hasNextFromLink(linkHeader) {
  if (!linkHeader) return false;
  // Example: <https://api.github.com/...&page=2>; rel="next", <...&page=5>; rel="last"
  return /rel="next"/i.test(linkHeader);
}

async function fetchSeatsPage(page) {
  const url = buildSeatsUrl(page);
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API error for seats page ${page}: ${res.status} ${res.statusText} ${text}`);
  }
  const body = await res.json();
  const link = res.headers.get('link');
  const hasNext = hasNextFromLink(link) || body?.has_next_page === true;
  const seatsArray = Array.isArray(body?.seats) ? body.seats : Array.isArray(body) ? body : [];
  const totalSeats = Number.isFinite(body?.total_seats) ? body.total_seats : null;
  const totalActiveSeats = Number.isFinite(body?.total_active_seats) ? body.total_active_seats : null;
  return { seatsArray, totalSeats, totalActiveSeats, hasNext };
}

async function upsertSeatsPage(client, { date, enterprise, organization, page, seatsArray, totalSeats, totalActiveSeats, hasNext }) {
  // Ensure NOT NULL total_seats constraint is respected
  const totalSeatsSafe = Number.isFinite(totalSeats) ? totalSeats : seatsArray.length;
  const text = `
    MERGE INTO public.seats_history AS t
    USING (
      SELECT $1::date  AS date,
             $2::text  AS enterprise,
             $3::text  AS organization,
             $4::int   AS page,
             $5::jsonb AS seats,
             $6::int   AS total_seats,
             $7::int   AS total_active_seats,
             $8::boolean AS has_next_page
    ) AS s
    ON (
      t.date = s.date
      AND COALESCE(t.enterprise, '') = COALESCE(s.enterprise, '')
      AND COALESCE(t.organization, '') = COALESCE(s.organization, '')
      AND COALESCE(t.page, 1) = COALESCE(s.page, 1)
    )
    WHEN MATCHED THEN
      UPDATE SET seats = s.seats,
                 total_seats = s.total_seats,
                 total_active_seats = s.total_active_seats,
                 has_next_page = s.has_next_page,
                 last_update = now()
    WHEN NOT MATCHED THEN
      INSERT (date, enterprise, organization, page, seats, total_seats, total_active_seats, has_next_page, last_update)
      VALUES (s.date, s.enterprise, s.organization, s.page, s.seats, s.total_seats, s.total_active_seats, s.has_next_page, now());
  `;
  const values = [date, enterprise, organization, page, JSON.stringify(seatsArray), totalSeatsSafe, totalActiveSeats, hasNext];
  await client.query(text, values);
}

async function main() {
  assertEnv();
  const pool = new Pool();
  const client = await pool.connect();
  let page = 1;
  let totalPages = 0;
  try {
    await client.query('BEGIN');
    do {
      const { seatsArray, totalSeats, totalActiveSeats, hasNext } = await fetchSeatsPage(page);
      const enterprise = GH.scope === 'enterprise' ? GH.enterprise : null;
      const organization = GH.scope === 'organization' ? GH.organization : null;
      await upsertSeatsPage(client, { date: RUN_DATE, enterprise, organization, page, seatsArray, totalSeats, totalActiveSeats, hasNext });
      totalPages += 1;
      console.log(`Upserted seats page ${page} (${seatsArray.length} seats)`);
      page += 1;
      // be gentle on API
      await new Promise((r) => setTimeout(r, 250));
      if (!hasNext) break;
    } while (true);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Done. Pages upserted: ${totalPages}`);
}

main().catch((err) => {
  console.error('Load failed:', err.message || err);
  process.exitCode = 1;
});
 
