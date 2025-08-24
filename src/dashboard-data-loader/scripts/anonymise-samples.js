#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const SAMPLE_DIR = path.join(__dirname, '..', 'samples');

// List of sample files to anonymise
const files = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith('.json'));

function anonymiseUser(user, idx) {
  if (!user || typeof user !== 'object') return user;
  return {
    ...user,
    login: `user${idx}`,
    id: idx,
    avatar_url: '',
    html_url: '',
    url: '',
    node_id: '',
    gravatar_id: '',
    followers_url: '',
    following_url: '',
    gists_url: '',
    starred_url: '',
    subscriptions_url: '',
    organizations_url: '',
    repos_url: '',
    events_url: '',
    received_events_url: '',
    type: user.type || 'User',
    user_view_type: user.user_view_type || 'public',
    site_admin: false
  };
}

function anonymiseTeam(team, idx) {
  if (!team || typeof team !== 'object') return team;
  return {
    ...team,
    id: idx,
    name: `Team${idx}`,
    slug: `team${idx}`,
    url: '',
    html_url: '',
    members_url: '',
    group_id: null,
    group_name: null,
    sync_to_organizations: 'disabled',
    created_at: '',
    updated_at: ''
  };
}

function anonymiseSeats(seatsArr) {
  return seatsArr.map((seat, idx) => {
    const s = { ...seat };
    if (s.assignee) s.assignee = anonymiseUser(s.assignee, idx + 1);
    if (s.assigning_team) s.assigning_team = anonymiseTeam(s.assigning_team, idx + 1);
    // Remove activity/editor info
    s.last_activity_editor = '';
    s.last_activity_at = null;
    s.created_at = '';
    s.updated_at = '';
    return s;
  });
}

function anonymiseSample(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${filePath}:`, e.message);
    return;
  }
  let changed = false;
  // seats.json
  if (Array.isArray(data.seats)) {
    data.seats = anonymiseSeats(data.seats);
    changed = true;
  }
  // org_ent_metrics.json, metrics.json: anonymise user/team fields in nested arrays
  if (Array.isArray(data)) {
    data = data.map((item, idx) => {
      if (item.seats && Array.isArray(item.seats)) {
        item.seats = anonymiseSeats(item.seats);
        changed = true;
      }
      return item;
    });
  }
  // teams.json: anonymise team objects
  if (Array.isArray(data) && filePath.endsWith('teams.json')) {
    data = data.map((team, idx) => anonymiseTeam(team, idx + 1));
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Anonymised: ${path.basename(filePath)}`);
  } else {
    console.log(`No changes for: ${path.basename(filePath)}`);
  }
}

for (const file of files) {
  anonymiseSample(path.join(SAMPLE_DIR, file));
}
