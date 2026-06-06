import 'dotenv/config';

const endpoint = 'http://localhost:3000/ask';

const questions = [
  // 1. Single lookup
  "How much did I spend on health in total?",
  // 2. Date filtering
  "What was my total spending in January 2024?",
  // 3. Refunds
  "How much did I spend on food in March after considering refunds?",
  // 4. Merchant aliases
  "How much did I spend on Swiggy across all its aliases?",
  // 5. Transfers
  "What is my total amount of transfers?",
  // 6. Category comparison
  "Compare my food and travel spending. Which one is higher overall?",
  // 7. Recurring subscriptions
  "Which merchants look like recurring subscriptions based on my transactions?",
  // 8. No-data cases
  "Do I have any data for rent in April 2025?",
  // 9. Fund period returns
  "What was Saffron Bluechip Equity Fund's period return percentage from 2024-01-01 to 2025-01-01?",
  // 10. Realised returns on holdings
  "What is my realised return on my Saffron Bluechip Equity Fund holding?",
  // 11. Portfolio aggregate
  "What is my total portfolio worth today, and how much have I made on it in absolute INR?",
  // 12. Complex comparison
  "Which category had the biggest absolute increase from January to February?"
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runEvals() {
  console.log(`Starting Evaluation Suite (${questions.length} questions)...\n`);
  let passed = 0;
  let failed = 0;
  const failedCases: any[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`[Q${i + 1}/${questions.length}] ${q}`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && errData.error) errMsg = `HTTP ${res.status}: ${errData.error}`;
        } catch (e) { }
        throw new Error(errMsg);
      }

      const data = await res.json();
      console.log(`Answer: ${data.answer.substring(0, 200).replace(/\\n/g, ' ')}...\n`);

      // For this suite, a valid 200 OK with a non-empty string answer is considered a technical pass.
      if (data && typeof data.answer === 'string' && data.answer.length > 0) {
        passed++;
      } else {
        throw new Error('Empty or invalid answer format');
      }
    } catch (err: any) {
      console.error(`ERROR: ${err.message}\n`);
      failed++;
      failedCases.push({ question: q, error: err.message });
    }

    if (i < questions.length - 1) {
      console.log("Waiting 45 seconds for Google API rate limit cooldown...\n");
      await sleep(45000);
    }
  }

  console.log('--- EVALUATION SUMMARY ---');
  console.log(`Total Passed: ${passed}`);
  console.log(`Total Failed: ${failed}`);
  if (failed > 0) {
    console.log('\\nFailed Cases:');
    failedCases.forEach(fc => console.log(`- ${fc.question}: ${fc.error}`));
  }
}

runEvals().catch(console.error);
