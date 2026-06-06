import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from 'pg';
import 'dotenv/config';

// Algorithmic Merchant Matching: Extracts the root word programmatically.
function canonicalizeMerchant(raw: string): string {
  const name = raw.toLowerCase();
  const match = name.match(/[a-z]{3,}/);
  if (match) {
    const root = match[0];
    return root.charAt(0).toUpperCase() + root.slice(1);
  }
  return raw;
}

// Dynamic Date Anchor logic
function resolveSemanticRange(input: string, anchorStr: string): { start: string, end: string } | null {
  const anchor = new Date(anchorStr);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const i = input.toLowerCase();

  if (i === 'all time') return null; // Let the main function skip filtering

  if (i === 'last month') {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }
  if (i === 'current month' || i === 'this month') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }
  if (i === 'q1') {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 2, 31);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }

  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const mIdx = months.findIndex(m => i.includes(m));
  if (mIdx !== -1) {
    let targetYear = year;
    if (i.includes((year - 1).toString())) targetYear = year - 1;
    const start = new Date(targetYear, mIdx, 1);
    const end = new Date(targetYear, mIdx + 1, 0);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }

  return null;
}

export const queryTransactions = createTool({
  id: 'query_transactions',
  description: 'Queries spending data. Handles relative dates (e.g. "March", "last month"). Groups and filters by category and merchant. Deducts refunds implicitly. Ignores transfers unless explicitly asked.',
  inputSchema: z.object({
    timeframe: z.string().optional().default('').describe('Date filter. Can be YYYY-MM-DD, or relative like "last month", "March", "Q1". Leave empty for all time.'),
    category: z.string().optional().default('').describe('Filter by category. E.g., "food", "travel". Use "transfer" to explicitly include transfers.'),
    merchantMatch: z.string().optional().default('').describe('A single keyword to match merchants using ILIKE. e.g. "swiggy"'),
    groupBy: z.enum(['month', 'category', 'merchant', 'none']).optional().default('none').describe('How to group the aggregated results. Use "month", "category", "merchant", or "none".'),
  }),
  execute: async (args: any) => {
    console.log("RAW TOOL ARGS:");
    console.dir(args, { depth: null });

    const context = args;
    const timeframe = context.timeframe === null ? undefined : context.timeframe;
    const category = context.category === null ? undefined : context.category;
    const merchantMatch = context.merchantMatch === null ? undefined : context.merchantMatch;
    const groupBy = (context.groupBy === null || context.groupBy === undefined) ? 'none' : context.groupBy;

    console.log('\n--- TOOL EXECUTION: query_transactions ---');
    console.log('ARGS:', JSON.stringify(context));

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    try {
      // 1. Dynamic Date Anchor
      const anchorRes = await db.query('SELECT MAX(date) as max_date FROM transactions');
      const anchorDate = anchorRes.rows[0].max_date ? anchorRes.rows[0].max_date.toISOString().split('T')[0] : '2024-01-01';

      let query = `SELECT * FROM transactions WHERE 1=1`;
      const params: any[] = [];
      let paramIndex = 1;

      // Resolve timeframe safely
      if (typeof timeframe === 'string' && timeframe.trim() !== '') {
        const tf = timeframe.toLowerCase().trim();
        if (tf !== 'all' && tf !== 'all time' && tf !== 'total' && tf !== 'none') {
          const resolved = resolveSemanticRange(timeframe, anchorDate);
          if (resolved) {
            params.push(resolved.start, resolved.end);
            query += ` AND date >= $${paramIndex} AND date <= $${paramIndex + 1}`;
            paramIndex += 2;
          } else if (timeframe.includes('to')) {
            // Handle '2000-01-01 to 2099-12-31' cleanly and strip quotes
            const parts = timeframe.split('to').map((p: string) => p.replace(/['"]/g, '').trim());
            params.push(parts[0], parts[1]);
            query += ` AND date >= $${paramIndex} AND date <= $${paramIndex + 1}`;
            paramIndex += 2;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(timeframe.trim())) {
            // Standard single date fallback ONLY if it looks like a real date
            params.push(timeframe.replace(/['"]/g, '').trim());
            query += ` AND date >= $${paramIndex}`;
            paramIndex += 1;
          }
          // If it fails all these checks (e.g. "forever"), we gracefully ignore the timeframe
          // instead of passing a garbage string to Postgres and crashing the query.
        }
      }

      // 3. Refund & Transfer Rules: Exclude 'transfer' unless explicitly queried
      if (category) {
        params.push(`%${category}%`); // Added wildcards for safer ILIKE matching
        query += ` AND category ILIKE $${paramIndex}`;
        paramIndex += 1;
      } else {
        query += ` AND category NOT ILIKE 'transfer'`;
      }

      if (merchantMatch) {
        params.push(`%${merchantMatch}%`);
        query += ` AND merchant ILIKE $${paramIndex}`;
        paramIndex += 1;
      }

      console.log('QUERY:', query);
      console.log('PARAMS:', params);

      const res = await db.query(query, params);
      const rows = res.rows;

      // 2. Algorithmic Merchant Matching & Aggregation
      let results: any = [];

      if (groupBy === 'none') {
        // Simple sum automatically deducts negative amounts (refunds)
        const net_spend = rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
        results = {
          anchorDate,
          transaction_count: rows.length,
          net_spend: parseFloat(net_spend.toFixed(2))
        };
      } else {
        const groups: Record<string, { count: number, net_spend: number }> = {};

        for (const row of rows) {
          let key = 'unknown';

          if (groupBy === 'month') {
            const d = new Date(row.date);
            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          } else if (groupBy === 'category') {
            key = row.category;
          } else if (groupBy === 'merchant') {
            key = canonicalizeMerchant(row.merchant);
          }

          if (!groups[key]) groups[key] = { count: 0, net_spend: 0 };
          groups[key].count += 1;
          groups[key].net_spend += parseFloat(row.amount);
        }

        results = Object.keys(groups).map(k => ({
          [groupBy]: k,
          count: groups[k].count,
          net_spend: parseFloat(groups[k].net_spend.toFixed(2))
        }));

        // Sort descending by spend
        results.sort((a: any, b: any) => b.net_spend - a.net_spend);
      }

      return results;
    } catch (e: any) {
      console.error("SQL ERROR IN TOOL:", e.message);
      throw e;
    } finally {
      await db.end();
    }
  }
});