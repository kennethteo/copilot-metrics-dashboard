PostgreSQL for Copilot Metrics Dashboard
=======================================

This folder contains a local PostgreSQL setup (Dockerfile + docker-compose) and an init script that creates the tables used by the dashboard when DATABASE_URL is configured.

What gets created
-----------------

- metrics_history: stores Copilot usage metrics (JSONB payload) per day/scope/team
- seats_history: stores Copilot billing seats snapshots (JSONB array) per day/scope/page

Both tables include helpful indexes (including JSONB GIN for seats) to accelerate common queries.

Run locally
-----------

1) Start Postgres:
	- Copy `.env` as needed or use the defaults in docker-compose.yml
	- In this folder run: docker compose up --build -d

2) The init.sql is copied into /docker-entrypoint-initdb.d/ and runs on first database creation for the volume.

Connection string
-----------------

Use this in the dashboard `.env.local` or `.env`:

DATABASE_URL=postgresql://dev_user:dev_password@localhost:5432/dev_db

SSL
---

If connecting to a managed Postgres that enforces SSL, set:

PGSSLMODE=require

so the app uses TLS with `rejectUnauthorized: false`.

Notes
-----

- The background ingestion process should insert rows into metrics_history and seats_history according to the schema here.
- If you need to reset the DB, remove the `postgres_data` volume: `docker compose down -v` and then start again.
