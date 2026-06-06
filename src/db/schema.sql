CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR PRIMARY KEY,
    date DATE NOT NULL,
    merchant VARCHAR NOT NULL,
    category VARCHAR NOT NULL,
    amount NUMERIC(19, 4) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    memo TEXT
);

-- Indexes for frequent filtering and grouping
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, date);

CREATE TABLE IF NOT EXISTS funds (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    category VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS fund_nav_history (
    fund_id VARCHAR NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    nav NUMERIC(19, 4) NOT NULL,
    PRIMARY KEY (fund_id, date)
);

-- Index for querying NAV by date range
CREATE INDEX IF NOT EXISTS idx_fund_nav_history_date ON fund_nav_history(date);

CREATE TABLE IF NOT EXISTS holdings (
    id SERIAL PRIMARY KEY,
    fund_id VARCHAR NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    units NUMERIC(19, 4) NOT NULL,
    purchase_date DATE NOT NULL,
    purchase_nav NUMERIC(19, 4) NOT NULL
);

-- Index for fast lookups of holdings by fund
CREATE INDEX IF NOT EXISTS idx_holdings_fund_id ON holdings(fund_id);
