import { Worker, Job } from 'bullmq';
import { Client } from 'pg';
import 'dotenv/config';

// Setup Redis connection for BullMQ. Defaults to localhost if not provided.
const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function startWorker() {
  try {
    await db.connect();
    console.log('Worker connected to Postgres');
  } catch (err) {
    console.error('Fatal: Worker failed to connect to Postgres:', err);
    process.exit(1);
  }

  const worker = new Worker('agent_tools', async (job: Job) => {
    console.log(`Processing job ${job.id} of type ${job.name}`);
    const { toolName, args } = job.data;

    try {
      // 1. Update job state to 'running'
      await db.query('UPDATE agent_jobs SET status = $1 WHERE id = $2', ['running', job.id]);

      let result: any;

      // 2. Execute heavy logic for analyze_portfolio
      if (toolName === 'analyze_portfolio') {
        const fund_id = args.fund_id === null ? undefined : args.fund_id;
        let holdingsQuery = `
          SELECT h.id, h.fund_id, f.name as fund_name, h.units, h.purchase_date, h.purchase_nav
          FROM holdings h
          JOIN funds f ON h.fund_id = f.id
        `;
        const params: any[] = [];

        if (fund_id) {
          holdingsQuery += ` WHERE h.fund_id = $1`;
          params.push(fund_id);
        }

        const holdingsRes = await db.query(holdingsQuery, params);

        if (holdingsRes.rows.length === 0) {
          result = { error: 'No holdings found.' };
        } else {
          let total_purchase_cost = 0;
          let total_current_value = 0;
          const breakdown = [];

          for (const holding of holdingsRes.rows) {
            // Look up the absolute latest NAV point for this fund
            const latestNavRes = await db.query(`
               SELECT nav, date 
               FROM fund_nav_history 
               WHERE fund_id = $1 
               ORDER BY date DESC 
               LIMIT 1
             `, [holding.fund_id]);

            const currentNav = latestNavRes.rows.length > 0 ? parseFloat(latestNavRes.rows[0].nav) : 0;
            const units = parseFloat(holding.units);
            const purchaseNav = parseFloat(holding.purchase_nav);

            const purchaseCost = units * purchaseNav;
            const currentValue = units * currentNav;
            const absoluteReturn = currentValue - purchaseCost;
            const percentageReturn = purchaseCost > 0 ? ((currentValue - purchaseCost) / purchaseCost) * 100 : 0;

            total_purchase_cost += purchaseCost;
            total_current_value += currentValue;

            breakdown.push({
              fund_name: holding.fund_name,
              units: parseFloat(units.toFixed(4)),
              purchase_nav: parseFloat(purchaseNav.toFixed(4)),
              current_nav: parseFloat(currentNav.toFixed(4)),
              purchase_cost: parseFloat(purchaseCost.toFixed(2)),
              current_value: parseFloat(currentValue.toFixed(2)),
              absolute_return_inr: parseFloat(absoluteReturn.toFixed(2)),
              percentage_return: parseFloat(percentageReturn.toFixed(2))
            });
          }

          const overallAbsoluteReturn = total_current_value - total_purchase_cost;
          const overallPercentageReturn = total_purchase_cost > 0 ? ((total_current_value - total_purchase_cost) / total_purchase_cost) * 100 : 0;

          result = {
            total_portfolio_purchase_cost: parseFloat(total_purchase_cost.toFixed(2)),
            total_portfolio_current_value: parseFloat(total_current_value.toFixed(2)),
            overall_absolute_return_inr: parseFloat(overallAbsoluteReturn.toFixed(2)),
            overall_percentage_return: parseFloat(overallPercentageReturn.toFixed(2)),
            breakdown
          };
        }
      } else {
        throw new Error(`Unknown async tool requested: ${toolName}`);
      }

      // 3. Write success result back to agent_jobs table as JSONB
      await db.query(
        'UPDATE agent_jobs SET status = $1, result = $2 WHERE id = $3',
        ['completed', JSON.stringify(result), job.id]
      );
      console.log(`Job ${job.id} completed successfully`);

    } catch (err: any) {
      console.error(`Job ${job.id} failed:`, err.message);
      // 4. Defensively handle failure by writing error state back to DB
      await db.query(
        'UPDATE agent_jobs SET status = $1, error = $2 WHERE id = $3',
        ['failed', err.message, job.id]
      );
      throw err;
    }
  }, { connection: redisConnection });

  worker.on('failed', (job, err) => {
    console.log(`[Worker Alert] Job ${job?.id} failed with reason: ${err.message}`);
  });

  worker.on('error', (err) => {
    if (err.message.includes('ECONNREFUSED')) {
      console.error('\n======================================================');
      console.error('[CRITICAL] Redis connection failed!');
      console.error('It looks like Redis is not running on port 6379.');
      console.error('Please ensure Redis is installed and running so the background worker can process jobs.');
      console.error('======================================================\n');
    } else {
      console.error(`[Worker Alert] Queue error: ${err.message}`);
    }
  });

  console.log('BullMQ Worker successfully started and listening to "agent_tools" queue...');
}

startWorker().catch(console.error);
