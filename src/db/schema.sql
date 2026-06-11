CREATE TABLE IF NOT EXISTS allocation_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_resource_id TEXT NOT NULL,
    target_cost_center TEXT NOT NULL,
    percentage REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
