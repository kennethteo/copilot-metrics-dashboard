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
  scope: process.env.GITHUB_API_SCOPE || 'organization', // 'enterprise' | 'organization'
};

// Optional date range
const SINCE = process.env.SINCE || process.env.START_DATE || '';
const UNTIL = process.env.UNTIL || process.env.END_DATE || '';

function ghHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GH.token}`,
    'X-GitHub-Api-Version': GH.version,
  };
}

function parseDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
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

function buildUrl() {
  const qs = new URLSearchParams();
  const since = parseDate(SINCE);
  const until = parseDate(UNTIL);
  if (since) qs.append('since', since);
  if (until) qs.append('until', until);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  if (GH.scope === 'enterprise') {
    return {
      url: `https://api.github.com/enterprises/${GH.enterprise}/copilot/metrics${query}`,
      enterprise: GH.enterprise,
      organization: null,
    };
  }
  return {
    url: `https://api.github.com/orgs/${GH.organization}/copilot/metrics${query}`,
    enterprise: null,
    organization: GH.organization,
  };
}

async function fetchScopeMetrics() {
  const { url } = buildUrl();
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API error for ${GH.scope} metrics: ${res.status} ${res.statusText} ${text}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Unexpected API shape: expected array');
  return data;
}

async function upsertMetrics(client, enterprise, organization, items) {
  let count = 0;
  for (const item of items) {
    const date = parseDate(item.day || item.date);
    if (!date) {
      console.warn('[skip] missing valid date in item');
      continue;
    }
    const text = `
      MERGE INTO public.metrics_history AS t
      USING (
        SELECT $1::date AS date,
               $2::text AS enterprise,
               $3::text AS organization,
               NULL::text AS team,
               $4::jsonb AS payload
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
    const values = [date, enterprise, organization, JSON.stringify(item)];
    await client.query(text, values);
    count += 1;
  }
  return count;
}

async function main() {
  assertEnv();
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { enterprise, organization } = buildUrl();
    console.log(`Fetching ${GH.scope} metrics...`);
    const items = await fetchScopeMetrics();
    const inserted = await upsertMetrics(client, enterprise, organization, items);
    await client.query('COMMIT');
    console.log(`Upserted ${inserted} rows for ${GH.scope} metrics.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Load failed:', err.message || err);
  process.exitCode = 1;
});
