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

- Load seats snapshot JSON into `seats_history`:

```sh
npm run load:seats
```

- Clear all data (truncate both tables):

```sh
npm run clear:all
```

You can override paths and scope via env vars at runtime:

```sh
METRICS_JSON=./samples/metrics.json \
SCOPE_ENTERPRISE=wilmar \
SCOPE_ORG=core \
SCOPE_TEAM=vn-gdc \
npm run load:metrics
```

```sh
SEATS_JSON=./samples/seats.json \
SCOPE_ENTERPRISE=wilmar \
SCOPE_ORG=core \
SEATS_PAGE=1 \
SEATS_HAS_NEXT_PAGE=false \
npm run load:seats
```

## Notes

- Upserts are based on the unique constraints defined in `init.sql`.
- Seats loader stores only the `seats` array in the JSONB column; the `total_seats` and `has_next_page` are stored in dedicated columns.
