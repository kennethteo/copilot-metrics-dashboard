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

// Team list (comma separated) for team metrics mode
const TEAMS = (process.env.TEAMS || process.env.SCOPE_TEAM || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Optional date range
const SINCE = process.env.SINCE || process.env.START_DATE || '';
const UNTIL = process.env.UNTIL || process.env.END_DATE || '';

// Shared GitHub request headers
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
  if (errs.length) {
    throw new Error(`Missing/invalid env: ${errs.join(', ')}`);
  }
}

function hasNextFromLink(linkHeader) {
  if (!linkHeader) return false;
  return /rel="next"/i.test(linkHeader);
}

async function fetchOrgTeamSlugs() {
  const perPage = 100;
  let page = 1;
  const slugs = [];
  while (true) {
    const url = `https://api.github.com/orgs/${GH.organization}/teams?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API error listing org teams: ${res.status} ${res.statusText} ${text}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      for (const t of data) if (t?.slug) slugs.push(t.slug);
    }
    const link = res.headers.get('link');
    const hasNext = hasNextFromLink(link) && Array.isArray(data) && data.length === perPage;
    page += 1;
    if (!hasNext) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return slugs;
}

async function fetchEnterpriseTeamSlugs() {
  const perPage = 100;
  let page = 1;
  const slugs = [];
  while (true) {
    const url = `https://api.github.com/enterprises/${GH.enterprise}/teams?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API error listing enterprise teams: ${res.status} ${res.statusText} ${text}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      for (const t of data) if (t?.slug) slugs.push(t.slug);
    }
    const link = res.headers.get('link');
    const hasNext = hasNextFromLink(link) && Array.isArray(data) && data.length === perPage;
    page += 1;
    if (!hasNext) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return slugs;
}

async function resolveTeamsInput() {
  if (TEAMS.length > 0) return TEAMS;
  console.log('TEAMS not provided; auto-discovering teams from GitHub...');
  const slugs = GH.scope === 'enterprise' ? await fetchEnterpriseTeamSlugs() : await fetchOrgTeamSlugs();
  if (!slugs.length) throw new Error('No teams found for the specified scope. Provide TEAMS or ensure you have permissions.');
  console.log(`Discovered ${slugs.length} team(s).`);
  return slugs;
}

function buildUrl(teamSlug) {
  const qs = new URLSearchParams();
  const since = parseDate(SINCE);
  const until = parseDate(UNTIL);
  if (since) qs.append('since', since);
  if (until) qs.append('until', until);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  if (GH.scope === 'enterprise') {
    return {
      url: `https://api.github.com/enterprises/${GH.enterprise}/team/${teamSlug}/copilot/metrics${query}`,
      enterprise: GH.enterprise,
      organization: null,
    };
  }
  return {
    url: `https://api.github.com/orgs/${GH.organization}/team/${teamSlug}/copilot/metrics${query}`,
    enterprise: null,
    organization: GH.organization,
  };
}

async function fetchTeamMetrics(teamSlug) {
  const { url } = buildUrl(teamSlug);
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API error for team '${teamSlug}': ${res.status} ${res.statusText} ${text}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected API shape for team '${teamSlug}': expected array`);
  }
  return data;
}

// Simple cache for team name lookups within a run
const TEAM_NAME_CACHE = new Map();

async function fetchOrgTeamName(teamSlug) {
  const url = `https://api.github.com/orgs/${GH.organization}/teams/${encodeURIComponent(teamSlug)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return null;
  const team = await res.json();
  return team?.name || team?.display_name || null;
}

async function fetchEnterpriseTeamName(teamSlug) {
  // Enterprise Teams list (paginate if needed); filter by slug
  // Keep it simple: fetch first page with per_page=100
  const url = `https://api.github.com/enterprises/${GH.enterprise}/teams?per_page=100`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return null;
  const teams = await res.json();
  const match = Array.isArray(teams) ? teams.find((t) => t?.slug === teamSlug) : null;
  return match?.name || null;
}

async function resolveTeamName(teamSlug) {
  if (TEAM_NAME_CACHE.has(teamSlug)) return TEAM_NAME_CACHE.get(teamSlug);
  let name = null;
  try {
    if (GH.scope === 'organization' && GH.organization) {
      name = await fetchOrgTeamName(teamSlug);
    } else if (GH.scope === 'enterprise' && GH.enterprise) {
      name = await fetchEnterpriseTeamName(teamSlug);
    }
  } catch (_) {
    // ignore
  }
  TEAM_NAME_CACHE.set(teamSlug, name || null);
  return name || null;
}

async function upsertMetrics(client, enterprise, organization, teamSlug, items, teamName) {
  let count = 0;
  for (const item of items) {
    // GitHub returns 'day' for daily metrics; fallback to 'date' if provided
    const date = parseDate(item.day || item.date);
    if (!date) {
      console.warn(`[skip] ${teamSlug}: missing valid date in item`);
      continue;
    }
  // Use full team name when available; fallback to slug
  const teamKey = teamName || teamSlug;

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
  const values = [date, enterprise, organization, teamKey, JSON.stringify(item)];
    await client.query(text, values);
    count += 1;
  }
  return count;
}

async function main() {
  assertEnv();
  const pool = new Pool();
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
  const teamSlugs = await resolveTeamsInput();
  for (const teamSlug of teamSlugs) {
      const { enterprise, organization } = buildUrl(teamSlug);
      console.log(`Fetching metrics for team '${teamSlug}' (${GH.scope})...`);
      // resolve full team name (best-effort)
      let teamName = await resolveTeamName(teamSlug);
      if (teamName) {
        console.log(`Resolved team name: ${teamName}`);
      }
      let items;
      try {
        items = await fetchTeamMetrics(teamSlug);
      } catch (e) {
        console.error(`[error] fetch failed for ${teamSlug}:`, e.message);
        continue; // proceed with other teams
      }
      const inserted = await upsertMetrics(client, enterprise, organization, teamSlug, items, teamName);
      console.log(`Upserted ${inserted} rows for team '${teamSlug}'.`);
      total += inserted;
      // small delay to be gentle on rate limits
      await new Promise((r) => setTimeout(r, 300));
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Done. Total rows upserted: ${total}`);
}

main().catch((err) => {
  console.error('Load failed:', err.message || err);
  process.exitCode = 1;
});
