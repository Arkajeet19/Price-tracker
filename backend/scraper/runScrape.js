import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { supabase } from '../db.js';
import { scrapeProduct } from './scraper.js';
/**
 * Runs one full scrape pass over every active tracked product.
 * Exported so it can be called both from the CLI (below) and from the
 * /api/cron/scrape HTTP route that an external cron service hits.
 * @param {{ headed?: boolean }} opts
 */
export async function runScrapeOnce(opts = {}) {
  const { data: products, error } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Failed to load tracked products:', error.message);
    process.exit(1);
  }

  if (!products || products.length === 0) {
    console.log('No active tracked products — nothing to scrape.');
    return { scraped: 0 };
  }

  const headed = !!opts.headed;
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext();

  console.log(`Starting scrape run for ${products.length} product(s). Headed=${headed}`);
  const results = [];

  for (const product of products) {
    const page = await context.newPage();
    const startedAt = new Date().toISOString();

    console.log(`\n→ Scraping "${product.product_name}" (${product.option_label})`);
    const result = await scrapeProduct(page, product);

    console.log(
      `  outcome=${result.outcome} price=${result.price} stock=${result.stock} ` +
        `attempts=${result.attempt_count}${result.error_message ? ` error="${result.error_message}"` : ''}`
    );

    const { error: insertError } = await supabase.from('price_history').insert({
      tracked_product_id: product.id,
      scraped_at: startedAt,
      price: result.price,
      stock: result.stock,
      outcome: result.outcome,
      attempt_count: result.attempt_count,
      error_message: result.error_message,
    });

    if (insertError) {
      // Log loudly — a failed *write* is just as dangerous as a failed scrape,
      // since it silently loses history. Never let this stop the rest of the run.
      console.error(`  !! Failed to write price_history row: ${insertError.message}`);
    }

    await page.close();
    results.push({ product: product.product_name, ...result });
  }

  await context.close();
  await browser.close();
  console.log('\nScrape run complete.');
  return { scraped: products.length, results };
}

// CLI entry point: `npm run scrape` or `npm run scrape:headed`
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  runScrapeOnce({ headed: process.env.HEADED === 'true' }).catch((err) => {
    // Catch-all so a scheduled invocation always exits with a clear signal
    // rather than hanging or crashing the host silently.
    console.error('Fatal error in scrape run:', err);
    process.exit(1);
  });
}
