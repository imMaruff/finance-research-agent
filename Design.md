# Finance-Research Agent (Tara) System Design

## 1. Postgres Schema Design
- **Tables**: Our data model utilizes five core tables: `transactions`, `funds`, `fund_nav_history`, `holdings`, and `agent_jobs`.
- **Data Types**: All currency, NAV, and unit values are stored strictly as `NUMERIC(19, 4)`. This guarantees exact, deterministic decimal math and completely prevents the floating-point inaccuracies typical of `FLOAT` or `DOUBLE PRECISION` types. 
- **Indexing Strategy**: We placed indexes on `date`, `category`, and `merchant` in the `transactions` table to support ultra-fast temporal and categorical filtering. We utilized a composite primary key on `(fund_id, date)` in `fund_nav_history`, ensuring O(log N) lookups for historical prices. `agent_jobs` is indexed on its `status` column to accelerate background polling.

## 2. Tool Design & Consolidation

The agent exposes three primary tools:
- `query_transactions`: Handles spending analysis, category filtering, merchant filtering, date filtering, refunds, transfer handling, and grouped aggregations.
- `analyze_fund_performance`: Computes historical mutual fund performance between arbitrary date ranges using NAV history.
- `analyze_portfolio`: Computes realised portfolio returns and overall portfolio valuation through asynchronous background processing.
Instead of creating many narrow tools (e.g., `get_total_spend`, `get_spend_by_category`, `get_top_merchants`), functionality is consolidated into a small number of highly parameterized tools. This reduces tool-selection complexity, minimizes prompt size, and improves tool-calling accuracy.

## 3. Data Grounding & Hallucination Prevention
Tara is strictly forbidden from doing arithmetic in her prose. 
- **System Prompt**: Her prompt explicitly commands her to state when data is missing rather than silently returning zero. 
- **Hard Constraints**: The tools exclusively return exact JSON numbers calculated deterministically within Postgres or TypeScript. By removing arithmetic responsibility from the LLM, there is zero room for non-deterministic numerical hallucinations. The agent acts purely as a linguistic translator for the data retrieved.

## 4. Core Algorithmic Formulas
- **Spend & Net Spend**: Refunds naturally appear as negative amounts in the raw data. A simple programmatic sum (`SUM(amount)`) across the transactions automatically nets out refunds to produce the exact net spend. Self-transfers are explicitly omitted via a `NOT ILIKE 'transfer'` clause unless the user explicitly requests them.

### Merchant Matching
Merchant filtering is implemented using case-insensitive PostgreSQL matching (`ILIKE`). For grouped merchant analytics, raw merchant names are normalized through a lightweight canonicalization algorithm that extracts the first alphabetic token from the merchant string and converts it into a standardized representation.
Examples:
- "SWIGGY BANGALORE" → "Swiggy"
- "Swiggy Instamart" → "Swiggy"
- "UPI/123/SWIGGY/" → "Swiggy"
This provides algorithmic alias grouping without maintaining large hardcoded lookup tables.

### Fund Period Return
Fund performance is calculated using historical NAV values stored in `fund_nav_history`.
For both the requested start date and end date, the system dynamically selects the closest available NAV entry:
`ORDER BY ABS(date - target_date) ASC LIMIT 1`

- **Holding Realised Return**: The background worker executes a heavy join across `holdings`, `funds`, and `fund_nav_history`. 
  - *Purchase Cost*: `units * purchase_nav`
  - *Current Value*: `units * current_nav`
  - *Absolute Return INR*: `current_value - purchase_cost`
  - *Percentage Return*: `((current_value - purchase_cost) / purchase_cost) * 100`

## 5. Async Orchestration
Computationally expensive portfolio analytics are executed asynchronously using BullMQ and Redis.
Workflow:
1. The agent invokes `analyze_portfolio`.
2. A unique job ID is generated.
3. The job metadata is persisted to PostgreSQL (`agent_jobs`).
4. The computation request is pushed to the BullMQ queue.
5. Background workers perform portfolio calculations independently.
6. Results are written back to the `agent_jobs` table.
This architecture prevents expensive portfolio computations from blocking the main request-processing pipeline and demonstrates scalable task delegation.

## 6. Evals & Observability
- **Testing Framework**: `scripts/eval.ts` contains 12 distinct POST requests targeting specific edge cases: relative date filtering, algorithmic aliases, multi-step categories, and missing data gaps. It verifies the endpoint reliably emits a standard HTTP 200 payload with the correct natural language response.
- **Observability**: Both the Express server and BullMQ workers stream distinct console logs for state transitions (`[Orchestration] Tool spawned async job...`), gracefully logging any failed background jobs or Postgres connection issues to ensure immediate visibility during debugging.

## 7. Future Improvements
With additional time, I would expand the architecture to include:
- **Redis Caching**: Cache frequent historical NAV lookups in Redis to skip redundant Postgres querying for the same anchor dates.
- **Semantic Category Matching**: Implement vector text embeddings (using `pgvector`) to intelligently classify "uncategorized" merchants based on cosine similarity to known datasets.
- **Enhanced Telemetry**: Deploy an OpenTelemetry integration to track granular tool latencies across the BullMQ distributed workers for deep performance profiling.
