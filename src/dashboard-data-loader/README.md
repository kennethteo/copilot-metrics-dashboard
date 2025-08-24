# Dashboard Data Loader

Tiny Node.js scripts to load sample Copilot metrics and seats JSON into the local Postgres defined under `infra/postgres`.

## Prereqs

- Node 18+
- A running Postgres with schema from `infra/postgres/init.sql` (use the docker-compose in that folder)

## Setup

1. Copy `.env.sample` to `.env` and adjust if needed.
2. Install deps in this folder only:

```sh
npm install
```


## Usage

- Test database connectivity:

```sh
npm run check:conn
```

- Load metrics array JSON into `metrics_history`:

```sh
npm run load:metrics
```

- Load team metrics directly from the GitHub API into `metrics_history` (team column populated):

```sh
# Configure .env first (see below), then run:
npm run load:metrics:api

# Or override via env in one shot:
GITHUB_API_SCOPE=enterprise \
GITHUB_ENTERPRISE=my-enterprise \
GITHUB_TOKEN=ghp_... \
TEAMS=team-a,team-b \
SINCE=2025-07-01 \
UNTIL=2025-07-31 \
npm run load:metrics:api
```

- Load seats snapshot JSON into `seats_history`:

```sh
npm run load:seats
```

- Load seats directly from the GitHub API into `seats_history` (paged):

```sh
# Configure .env first (see below), then run:
npm run load:seats:api

# Or override via env in one shot:
GITHUB_API_SCOPE=organization \
GITHUB_ORGANIZATION=my-org \
GITHUB_TOKEN=ghp_... \
DATE=2025-07-31 \
PER_PAGE=100 \
npm run load:seats:api
```


- Clear all data (truncate both tables):

```sh
npm run clear:all
```

- Anonymise all sample JSON files in `samples/`:

```sh
npm run anonymise:samples
```

You can override paths and scope via env vars at runtime:

```sh
METRICS_JSON=./samples/metrics.json \
SCOPE_ENTERPRISE=enterprise1 \
SCOPE_ORG=core \
SCOPE_TEAM=vn-gdc \
npm run load:metrics
```

```sh
SEATS_JSON=./samples/seats.json \
SCOPE_ENTERPRISE=enterprise1 \
SCOPE_ORG=core \
SEATS_PAGE=1 \
SEATS_HAS_NEXT_PAGE=false \
npm run load:seats
```

API loader env vars (add these to `.env` or inline as above):

- GITHUB_ORGANIZATION / GITHUB_ENTERPRISE
- GITHUB_TOKEN
- GITHUB_API_VERSION (default 2022-11-28)
- GITHUB_API_SCOPE (enterprise|organization)
- TEAMS (comma-separated team slugs)
- SINCE, UNTIL (YYYY-MM-DD)
- DATE (YYYY-MM-DD, used by seats API loader; defaults to today)
- PER_PAGE (page size for seats API; defaults to 100)

## Notes

- Upserts are based on the unique constraints defined in `init.sql`.
- Seats loader stores only the `seats` array in the JSONB column; the `total_seats` and `has_next_page` are stored in dedicated columns.
- API team loader writes one row per day per team into `metrics_history` with the `team` column set to the full team name when available (falls back to slug). The full daily item is stored in `payload`.
