import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { router as productsRouter } from './routes/products.js';
import { runScrapeOnce } from './scraper/runScrape.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', productsRouter);

// Hit by the external cron service (e.g. cron-job.org) every 2 hours.
// Protected by a shared secret so randoms on the internet can't trigger scrapes.
app.get('/api/cron/scrape', async (req, res) => {
  if (req.query.token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }
  try {
    const result = await runScrapeOnce({ headed: false });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron-triggered scrape failed:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
