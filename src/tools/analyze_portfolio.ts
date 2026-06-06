import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { Client } from 'pg';
import crypto from 'crypto';
import 'dotenv/config';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const analyzePortfolio = createTool({
  id: 'analyze_portfolio',
  description: 'Calculates the realised return on specific holdings or the entire portfolio. This is a heavy computation and executes asynchronously via BullMQ.',
  inputSchema: z.object({
    fund_id: z.string().optional().default('').describe('Optional. Specific fund ID to analyze the holding for. If omitted, computes overall portfolio.')
  }),
  execute: async (args: any) => {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    const toolQueue = new Queue('agent_tools', { connection: redisConnection });
    toolQueue.on('error', (err) => {
      if (err.message.includes('ECONNREFUSED')) {
        console.error('\n======================================================');
        console.error('[CRITICAL] Redis connection failed in analyze_portfolio!');
        console.error('It looks like Redis is not running on port 6379.');
        console.error('Please ensure Redis is installed and running.');
        console.error('======================================================\n');
      } else {
        console.error('BullMQ Queue Error:', err.message);
      }
    });

    await db.connect();

    try {
      // 1. Generate unique Job ID
      const jobId = crypto.randomUUID();

      // 2. Insert tracking state into PostgreSQL agent_jobs table
      await db.query(
        'INSERT INTO agent_jobs (id, tool_name, status) VALUES ($1, $2, $3)',
        [jobId, 'analyze_portfolio', 'pending']
      );

      // 3. Add background task to BullMQ
      await toolQueue.add('analyze_portfolio', {
        toolName: 'analyze_portfolio',
        args: args
      }, { jobId });

      // 4. Return Milestone Contract
      return {
        job_id: jobId,
        status: 'running',
        message: 'The portfolio analysis has been submitted for background processing.'
      };
    } finally {
      await db.end();
      // Wait for BullMQ to register connection briefly before disconnecting is handled automatically
    }
  }
});
