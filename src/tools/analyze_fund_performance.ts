import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from 'pg';
import 'dotenv/config';

export const analyzeFundPerformance = createTool({
  id: 'analyze_fund_performance',
  description: 'Computes the standard period return percentage for a fund between two dates based on NAV history.',
  inputSchema: z.object({
    fund_id: z.string().describe('Fund identifier or exact fund name.'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)')
  }),
  execute: async (args: any) => {
    const { fund_id, startDate, endDate } = args;
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    try {
      // Fetch closest start NAV
      const startRes = await db.query(`
        SELECT nav, date 
        FROM fund_nav_history 
        WHERE fund_id = $1 
        ORDER BY ABS(date - $2::date) ASC 
        LIMIT 1
      `, [fund_id, startDate]);

      // Fetch closest end NAV
      const endRes = await db.query(`
        SELECT nav, date 
        FROM fund_nav_history 
        WHERE fund_id = $1 
        ORDER BY ABS(date - $2::date) ASC 
        LIMIT 1
      `, [fund_id, endDate]);

      if (startRes.rows.length === 0 || endRes.rows.length === 0) {
        return { error: 'Insufficient NAV history found for this fund.' };
      }

      const startNav = parseFloat(startRes.rows[0].nav);
      const endNav = parseFloat(endRes.rows[0].nav);
      const actualStartDate = startRes.rows[0].date.toISOString().split('T')[0];
      const actualEndDate = endRes.rows[0].date.toISOString().split('T')[0];

      const periodReturnPercentage = ((endNav - startNav) / startNav) * 100;

      return {
        fund_id,
        actual_start_date_used: actualStartDate,
        start_nav: parseFloat(startNav.toFixed(2)),
        actual_end_date_used: actualEndDate,
        end_nav: parseFloat(endNav.toFixed(2)),
        period_return_percentage: parseFloat(periodReturnPercentage.toFixed(2))
      };
    } finally {
      await db.end();
    }
  }
});
