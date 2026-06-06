# Finance-Research Agent (Tara)

Tara is an autonomous, multi-turn AI finance agent designed to query transaction databases, calculate fund NAV returns, and analyze investment portfolios. She connects to a PostgreSQL database and leverages BullMQ & Redis for heavy asynchronous task orchestration.

## Prerequisites

Before starting, ensure you have the following installed and running locally:
1. **Node.js** (v20+ recommended)
2. **PostgreSQL** (Running on port 5432)
3. **Redis** (Running on port 6379) - *Required for BullMQ async orchestration.*

---

## 🚨 Note to Reviewers on API Quotas
**IMPORTANT:** The full 12-question evaluation suite (`eval.ts`) relies on the `gemini-2.5-flash` model. Google's Free Tier for this API restricts usage to a burst limit of **15 requests per minute** and **1,500 requests per day**. Because Tara is an autonomous agent that uses a multi-turn loop (generating tool calls, executing them, and feeding the result back), each question requires *at least* 2 API calls. 

If you attempt to run the entire evaluation suite rapidly using a Free Tier key, you will hit the strict `429 Quota Exceeded` limit. To evaluate the entire suite continuously, an **Enterprise / Pay-As-You-Go Google API Key** is required.

---

## Setup Instructions

**1. Install Dependencies**

npm install

**2. Configure Environment Variables**
Copy the sample environment file and insert your API credentials:

cp .env.example .env

Ensure `.env` contains your active `DATABASE_URL`, your `GOOGLE_GENERATIVE_AI_API_KEY`, and `REDIS_PORT=6379`.

**3. Database Migration & Ingestion**
Initialize the database schemas and insert the sample dataset:

npx tsx scripts/ingest.ts


**4. Start the Async Worker (Terminal 1)**
Tara relies on a background worker to execute heavy portfolio analyses. In a new terminal, start the worker:
 
 npx tsx src/workers/tool_worker.ts

**5. Start the Express Server (Terminal 2)**
Start the API orchestration server:

npx tsx --env-file=.env src/server.ts

**6. Run the Evaluation Suite (Terminal 3)**
With both the worker and the server running, execute the evaluation suite:

npx tsx scripts/eval.ts


## Architecture

- **Mastra AI Framework:** Provides tool schemas, routing, and memory management.
- **Express / Node.js:** Exposes the `/ask` HTTP endpoint and orchestrates the agent loops.
- **PostgreSQL:** Stores transactional data, fund NAVs, portfolio holdings, and maintains agent state (`agent_jobs` table).
- **BullMQ / Redis:** Handles computationally heavy or external tools asynchronously to unblock the main Express thread.
