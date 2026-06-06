import { Client } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

// Path to the schema file
const schemaPath = path.join(__dirname, '../src/db/schema.sql');

async function ingest() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data/sample_a');
  console.log(`Starting ingestion from ${dataDir}...`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not set in the environment.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    
    // Create tables from schema
    const schemaSql = await fs.readFile(schemaPath, 'utf-8');
    await client.query(schemaSql);
    console.log('Schema created/verified.');

    // Clear existing data to ensure a fresh ingest
    // CASCADE ensures we don't hit foreign key constraint violations during truncation
    await client.query('TRUNCATE TABLE transactions, funds, holdings CASCADE');
    console.log('Cleared existing data.');

    // --- Ingest Transactions ---
    const transactionsPath = path.join(dataDir, 'transactions.json');
    const transactionsData = JSON.parse(await fs.readFile(transactionsPath, 'utf-8'));
    
    console.log(`Inserting ${transactionsData.length} transactions...`);
    for (let i = 0; i < transactionsData.length; i += 500) {
      const chunk = transactionsData.slice(i, i + 500);
      const values: any[] = [];
      const placeholders: string[] = [];
      
      chunk.forEach((t: any, index: number) => {
        const offset = index * 7;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
        values.push(t.id, t.date, t.merchant, t.category, t.amount, t.currency, t.memo || null);
      });
      
      await client.query(`
        INSERT INTO transactions (id, date, merchant, category, amount, currency, memo)
        VALUES ${placeholders.join(', ')}
      `, values);
    }

    // --- Ingest Funds and NAV History ---
    const fundsPath = path.join(dataDir, 'funds.json');
    const fundsData = JSON.parse(await fs.readFile(fundsPath, 'utf-8'));
    
    console.log(`Inserting ${fundsData.length} funds...`);
    for (const fund of fundsData) {
      await client.query(`
        INSERT INTO funds (id, name, category)
        VALUES ($1, $2, $3)
      `, [fund.id, fund.name, fund.category]);

      const navValues: any[] = [];
      const navPlaceholders: string[] = [];
      
      fund.nav.forEach((n: any, index: number) => {
        const offset = index * 3;
        navPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        navValues.push(fund.id, n.date, n.value);
      });
      
      if (navPlaceholders.length > 0) {
        await client.query(`
          INSERT INTO fund_nav_history (fund_id, date, nav)
          VALUES ${navPlaceholders.join(', ')}
        `, navValues);
      }
    }

    // --- Ingest Holdings ---
    const holdingsPath = path.join(dataDir, 'holdings.json');
    const holdingsData = JSON.parse(await fs.readFile(holdingsPath, 'utf-8'));
    
    console.log(`Inserting ${holdingsData.length} holdings...`);
    for (const holding of holdingsData) {
      await client.query(`
        INSERT INTO holdings (fund_id, units, purchase_date, purchase_nav)
        VALUES ($1, $2, $3, $4)
      `, [holding.fund_id, holding.units, holding.purchase_date, holding.purchase_nav]);
    }

    console.log('Ingestion completed successfully.');
  } catch (err) {
    console.error('Error during ingestion:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

ingest();
