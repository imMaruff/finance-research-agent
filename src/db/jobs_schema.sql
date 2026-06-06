CREATE TABLE IF NOT EXISTS agent_jobs (
    id VARCHAR PRIMARY KEY,
    tool_name VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running', -- can be 'running', 'completed', 'failed'
    result JSONB,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index to quickly look up jobs by status or id
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status);
