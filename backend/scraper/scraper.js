/**
 * Core scraping logic for the mock storefront.
 *
 * Real flow discovered by inspecting the live store (devtools):
 *   1. Product page loads with option buttons (e.g. "Solo"/"Duo"/"Family"/"Group").
 *   2. Click the option we're tracking.
 *   3. A "Price locked" button appears; after a short delay it becomes
 *      "Check today's price" and is clickable.
 *   4. Clicking it triggers a handshake + quote call under the hood. The quote
 *      call is deliberately obfuscated (WASM proof-of-work + an encrypted
 *      blob response) -- decoding that directly is a rabbit hole, and it isn't
 *      necessary: the frontend does the decoding itself and renders the real
 *      price in the DOM. The quote call also fails intermittently
 *      (observed: a 500 "upstream_error") -- the page appears to retry it
 *      itself, but we still wrap the whole click sequence in our own retry
 *      loop below in case that self-retry doesn't always recover.
 *   5. The real price (Rs figure) and a stock line ("N UNITS AVAILABLE")
 *      render on the page -- read those directly from the DOM.
 *
 * This is a case where a headless browser is genuinely required (not just
 * convenient): the price only ever exists, unobfuscated, in the rendered DOM.
 */

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1000; // exponential: 1s, 2s, 4s, 8s
const NAV_TIMEOUT_MS = 15000;
const UNLOCK_TIMEOUT_MS = 10000; // "Price locked" -> "Check today's price"
const PRICE_TIMEOUT_MS = 15000; // click -> real price rendered (observed: usually ~1-5s, extra headroom for unattended runs)

const PRICE_REGEX = /\u20b9\s?[\d,]+/g;
const STOCK_REGEX = /(SOLD OUT|OUT OF STOCK|LAST FEW:\s*\d+|READY TO SHIP[^\n]*?\d+\s*AVAILABLE|AVAILABLE\s*\(\d+\)|IN STOCK)/i;
// The site interleaves invisible zero-width characters between digits of the
// REAL (current) price specifically -- stripping them before matching fixes
// a scraper that would otherwise only ever capture the plain, struck-through
// ORIGINAL price.
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Scrape a single tracked product's current price & stock.
 * Never throws -- always resolves to a result object so the caller can log
 * a 'failed' outcome instead of crashing the whole scheduled run.
 *
 * @param {import('playwright').Page} page
 * @param {{ product_url: string, option_label: string, store_product_id: string }} product
 */
export async function scrapeProduct(page, product) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await page.goto(product.product_url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      // Select the capacity/option we're tracking (buttons are plain text,
      // e.g. "Solo" / "Duo" / "Family" / "Group" -- no reliable CSS classes
      // were found, so match by visible text instead).
            if (product.option_label) {
        await page
          .getByRole('button', { name: product.option_label, exact: true })
          .click({ timeout: 5000 });
      }

      // "Price locked" only reveals itself as the clickable "Check today's
      // price" after being HOVERED for a few seconds — just waiting with no
      // interaction leaves it stuck forever.
            // "Price locked" reveals "Check today's price" text quickly, but the
      // button stays `disabled` until it detects sustained hovering -- one
      // synthetic .hover() call (a single mouseenter) isn't enough here, so
      // we simulate small continuous mouse jitter over the button, like a
      // real hand resting on it, until the disabled attribute actually clears.
      const priceButton = page.getByRole('button', { name: /Price locked|Check today.s price/i });
      await priceButton.waitFor({ state: 'visible', timeout: 5000 });

      const box = await priceButton.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const deadline = Date.now() + UNLOCK_TIMEOUT_MS;
        let enabled = false;
        while (Date.now() < deadline) {
          await page.mouse.move(cx + (Math.random() * 4 - 2), cy + (Math.random() * 4 - 2));
          await page.waitForTimeout(200);
          enabled = await priceButton.isEnabled().catch(() => false);
          if (enabled) break;
        }
        if (!enabled) {
          throw new Error('Price button never became enabled after sustained hover');
        }
      }

      await priceButton.click({ timeout: 5000 });

      // Wait for a real price to render. The underlying quote call can fail
      // and silently retry itself, so we wait generously here rather than
      // reading the first thing that appears.
      await page.waitForFunction(
        () => /\u20b9\s?[\d,]+/.test(document.body.innerText),
        { timeout: PRICE_TIMEOUT_MS }
      );

      const rawBodyText = await page.locator('body').innerText();
      const bodyText = rawBodyText.replace(ZERO_WIDTH_CHARS, '');
      const price = parsePrice(bodyText);
      if (price === null) {
        throw new Error("Price text matched but could not be parsed to a number");
      }

      const stockMatch = bodyText.match(STOCK_REGEX);
      const stock = stockMatch ? stockMatch[0].trim() : extractStockFallback(bodyText);

      return {
        outcome: attempt === 1 ? 'success' : 'retried',
        price,
        stock,
        attempt_count: attempt,
        error_message: null,
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
    }
  }

  // Every attempt failed -- record honestly, with no price/stock guessed in.
  return {
    outcome: 'failed',
    price: null,
    stock: null,
    attempt_count: MAX_ATTEMPTS,
    error_message: lastError ? String(lastError.message || lastError) : 'Unknown error',
  };
}

/**
 * The page shows a struck-through original price followed by the real
 * (discounted) price, e.g. "Rs44,394 Rs30,632" -- the current price is the
 * LAST currency match on the page, not the first.
 * TODO: confirm this holds for a product with no discount (only one match).
 */
function parsePrice(bodyText) {
  const matches = bodyText.match(PRICE_REGEX);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const numeric = last.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numeric);
  return Number.isNaN(parsed) ? null : parsed;
}

// TODO: replace once we've seen real out-of-stock wording on the site.
function extractStockFallback() {
  return null;
}
