-- Database schema for GitHub Copilot Metrics Dashboard
-- Replaces Azure Cosmos DB containers with PostgreSQL tables

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the main database and schema
CREATE SCHEMA IF NOT EXISTS copilot_metrics;

-- Organization-level historical data (replaces 'history' container)
CREATE TABLE IF NOT EXISTS copilot_metrics.history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM (partition key equivalent)
    enterprise VARCHAR(255),
    organization VARCHAR(255),
    total_active_users INTEGER,
    total_engaged_users INTEGER,
    data JSONB NOT NULL, -- Store the full JSON data for flexibility
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for partitioning equivalent
CREATE INDEX IF NOT EXISTS idx_history_month ON copilot_metrics.history(month);
CREATE INDEX IF NOT EXISTS idx_history_enterprise ON copilot_metrics.history(enterprise);
CREATE INDEX IF NOT EXISTS idx_history_organization ON copilot_metrics.history(organization);

-- Detailed metrics history (replaces 'metrics_history' container)  
CREATE TABLE IF NOT EXISTS copilot_metrics.metrics_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL, -- Partition key equivalent
    enterprise VARCHAR(255),
    organization VARCHAR(255),
    team VARCHAR(255),
    day DATE NOT NULL, -- The actual date from the data
    total_active_users INTEGER,
    total_engaged_users INTEGER,
    total_ide_engaged_users INTEGER,
    total_code_suggestions INTEGER,
    total_code_acceptances INTEGER,
    total_code_lines_suggested INTEGER,
    total_code_lines_accepted INTEGER,
    total_chat_engaged_users INTEGER,
    total_chats INTEGER,
    total_chat_insertion_events INTEGER,
    total_chat_copy_events INTEGER,
    time_frame_week VARCHAR(50),
    time_frame_month VARCHAR(50),
    time_frame_display VARCHAR(50),
    breakdown JSONB, -- Store breakdown data as JSON
    data JSONB NOT NULL, -- Store the complete original JSON data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(date, COALESCE(enterprise, ''), COALESCE(organization, ''), COALESCE(team, ''))
);

-- Create indexes for optimal querying
CREATE INDEX IF NOT EXISTS idx_metrics_history_date ON copilot_metrics.metrics_history(date);
CREATE INDEX IF NOT EXISTS idx_metrics_history_day ON copilot_metrics.metrics_history(day);
CREATE INDEX IF NOT EXISTS idx_metrics_history_enterprise ON copilot_metrics.metrics_history(enterprise);
CREATE INDEX IF NOT EXISTS idx_metrics_history_organization ON copilot_metrics.metrics_history(organization);
CREATE INDEX IF NOT EXISTS idx_metrics_history_team ON copilot_metrics.metrics_history(team);
CREATE INDEX IF NOT EXISTS idx_metrics_history_date_range ON copilot_metrics.metrics_history(date, enterprise, organization);

-- Seat allocation history (replaces 'seats_history' container)
CREATE TABLE IF NOT EXISTS copilot_metrics.seats_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL, -- Partition key equivalent  
    enterprise VARCHAR(255),
    organization VARCHAR(255),
    total_seats INTEGER,
    total_active_seats INTEGER,
    page INTEGER,
    has_next_page BOOLEAN DEFAULT FALSE,
    last_update TIMESTAMP WITH TIME ZONE,
    seats JSONB, -- Store seats data as JSON array
    data JSONB NOT NULL, -- Store the complete original JSON data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(date, COALESCE(enterprise, ''), COALESCE(organization, ''), page)
);

-- Create indexes for seat history
CREATE INDEX IF NOT EXISTS idx_seats_history_date ON copilot_metrics.seats_history(date);
CREATE INDEX IF NOT EXISTS idx_seats_history_enterprise ON copilot_metrics.seats_history(enterprise);
CREATE INDEX IF NOT EXISTS idx_seats_history_organization ON copilot_metrics.seats_history(organization);
CREATE INDEX IF NOT EXISTS idx_seats_history_date_range ON copilot_metrics.seats_history(date, enterprise, organization);

-- Table partitioning for performance (optional but recommended for large datasets)
-- Note: PostgreSQL 10+ supports declarative partitioning

-- Partition metrics_history by date range (monthly partitions)
-- This replaces the Cosmos DB partition strategy
/*
Example partitioning setup (uncomment if needed):

ALTER TABLE copilot_metrics.metrics_history PARTITION BY RANGE (date);

CREATE TABLE copilot_metrics.metrics_history_2024_01 PARTITION OF copilot_metrics.metrics_history
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE copilot_metrics.metrics_history_2024_02 PARTITION OF copilot_metrics.metrics_history
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
*/

-- Create function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for auto-updating timestamps
CREATE TRIGGER update_history_updated_at BEFORE UPDATE ON copilot_metrics.history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_metrics_history_updated_at BEFORE UPDATE ON copilot_metrics.metrics_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_seats_history_updated_at BEFORE UPDATE ON copilot_metrics.seats_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();