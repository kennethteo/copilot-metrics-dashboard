-- Initialize schema for Copilot metrics dashboard
-- This script is executed automatically when the container initializes the database

-- Create extension(s) commonly used
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid if needed

-- =============================
-- Table: metrics_history
--  Purpose: stores daily Copilot usage metrics payloads
-- =============================
CREATE TABLE IF NOT EXISTS public.metrics_history (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE        NOT NULL,
    enterprise      TEXT,
    organization    TEXT,
    team            TEXT,
    payload         JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avoid duplicate rows for the same day/scope/team
CREATE UNIQUE INDEX IF NOT EXISTS ux_metrics_history_scope
ON public.metrics_history (date, COALESCE(enterprise, ''), COALESCE(organization, ''), COALESCE(team, ''));

-- Speed up range/date scoped queries
CREATE INDEX IF NOT EXISTS ix_metrics_history_date ON public.metrics_history (date);
CREATE INDEX IF NOT EXISTS ix_metrics_history_scope ON public.metrics_history (enterprise, organization, team);


-- =============================
-- Table: seats_history
--  Purpose: stores Copilot seats snapshots (paged) for a given day
-- =============================
CREATE TABLE IF NOT EXISTS public.seats_history (
    id                   BIGSERIAL PRIMARY KEY,
    date                 DATE        NOT NULL,
    enterprise           TEXT,
    organization         TEXT,
    page                 INT,
    seats                JSONB       NOT NULL,
    total_seats          INT         NOT NULL DEFAULT 0,
    total_active_seats   INT,
    has_next_page        BOOLEAN     NOT NULL DEFAULT FALSE,
    last_update          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one row per scope/page/day
CREATE UNIQUE INDEX IF NOT EXISTS ux_seats_history_scope
ON public.seats_history (date, COALESCE(enterprise, ''), COALESCE(organization, ''), COALESCE(page, 1));

-- Common filters
CREATE INDEX IF NOT EXISTS ix_seats_history_date ON public.seats_history (date);
CREATE INDEX IF NOT EXISTS ix_seats_history_scope ON public.seats_history (enterprise, organization, page);

-- Optional: GIN index to accelerate JSONB operations over seats
CREATE INDEX IF NOT EXISTS gin_seats_history_seats ON public.seats_history USING gin (seats);

-- Example: query by assigning team name using JSONB
-- SELECT * FROM seats_history
-- WHERE date = CURRENT_DATE
--   AND EXISTS (
--     SELECT 1
--     FROM jsonb_array_elements(seats) AS seat
--     WHERE seat->'assigning_team'->>'name' = 'Team Name'
--   );

