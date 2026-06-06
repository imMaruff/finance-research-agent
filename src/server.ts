import express from 'express';
import { Client } from 'pg';
import 'dotenv/config';

import { taraAgent } from './agents/tara';

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

// Reusable db client for checking job status
const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Helper to poll the database for job completion
async function waitForJobCompletion(jobId: string): Promise<any> {
  while (true) {
    const res = await db.query('SELECT status, result, error FROM agent_jobs WHERE id = $1', [jobId]);
    if (res.rows.length > 0) {
      const job = res.rows[0];
      if (job.status === 'completed') {
        return job.result;
      } else if (job.status === 'failed') {
        throw new Error(`Job failed: ${job.error}`);
      }
    }
    // Wait 1 second before polling again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Initialize conversation history
    const messages: any[] = [
      { role: 'user', content: question }
    ];

    let finalAnswer = '';

    // The orchestration loop
    while (true) {
      // 1. Call the Mastra Agent
      const result: any = await taraAgent.generate(messages);

      // 2. Append the assistant's response to the conversation history
      if (result.text) {
        messages.push({ role: 'assistant', content: result.text });
        finalAnswer = result.text;
      }

      // 3. Check if any tools were called and if they spawned async jobs
      let asyncJobSpawned = false;

      if (result.toolCalls) {
        console.log('[Orchestration] LLM attempted tool calls:', JSON.stringify(result.toolCalls, null, 2));
      }

      if (result.toolResults && result.toolResults.length > 0) {
        console.log('[Orchestration] Tool results from Mastra:', JSON.stringify(result.toolResults, null, 2));
        for (const tr of result.toolResults) {
          const toolData = tr.result;

          // Check if this tool returned the async milestone signature
          if (toolData && toolData.status === 'running' && toolData.job_id) {
            asyncJobSpawned = true;
            console.log(`[Orchestration] Tool spawned async job: ${toolData.job_id}. Waiting for completion...`);

            // Block the HTTP request until the background worker finishes the job
            try {
              const jobResult = await waitForJobCompletion(toolData.job_id);

              // 4. Feed the result back into a fresh agent turn via a synthetic system prompt
              messages.push({
                role: 'system',
                content: `<async_tool_completion>job_id=${toolData.job_id}\nresult=${JSON.stringify(jobResult)}</async_tool_completion>`
              });

            } catch (jobErr: any) {
              messages.push({
                role: 'system',
                content: `<async_tool_completion>job_id=${toolData.job_id}\nerror=${jobErr.message}</async_tool_completion>`
              });
            }
          }
        }
      }

      // 5. If no async jobs were spawned in this turn, the agent has finished answering
      if (!asyncJobSpawned) {
        break;
      }
    }

    // 6. Return the final answer in a single, clean HTTP response
    res.json({ answer: finalAnswer });

  } catch (error: any) {
    console.error('Error in /ask:', error);
    res.status(500).json({ error: error?.message || (typeof error === 'string' ? error : 'Internal Server Error') });
  }
});

// Start the server
async function startServer() {
  await db.connect();

  // Create jobs table if not exists, so server starts cleanly
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id VARCHAR PRIMARY KEY,
      tool_name VARCHAR NOT NULL,
      status VARCHAR NOT NULL DEFAULT 'running',
      result JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  app.listen(port, () => {
    console.log(`Tara Agent server listening on port ${port}`);
  });
}

startServer().catch(console.error);
