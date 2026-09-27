# Design Note — Price Tracker Reliability

## Approach

The mock storefront looks static at first glance, but three separate layers
of "awkwardness" sit between a naive scraper and a correct price:

1. **No server-rendered content, no search endpoint of its own.** The
   homepage is a client-rendered SPA — a plain HTTP GET returns almost
   nothing. Rather than assuming this meant "everything needs a headless
   browser," I checked the Network tab first and found the store *does*
   expose a real paginated JSON API (`/api/v2/listings`) for the product
   catalog. I used that directly for search (fetch all 48 pages once, cache
   in memory, filter by name) — no browser needed for that part at all, which
   matches the assignment's "prefer lightweight fetching where possible"
   guidance.
2. **Price/stock genuinely require a browser.** Per-product pricing is
   locked behind a sequence of UI states (select an option → a disabled
   "Price locked" button → hover to unlock → click to reveal), and the
   underlying network call for the actual quote returns a WASM proof-of-work
   challenge plus an encrypted response blob rather than a plain price. I
   spent time trying to understand whether this was reverse-engineerable,
   decided it wasn't worth the risk this close to a deadline, and confirmed
   the frontend itself does the decoding — so the scraper's job is to drive
   the same UI a real user would and read the rendered result, not bypass it.
3. **The rendered price text is itself obfuscated.** The real (current)
   price interleaves invisible zero-width characters between its digits,
   specifically to defeat a scraper that reads price text with a simple
   regex. This one was the most dangerous of the three, because it doesn't
   throw an error — it just silently produces a *plausible-looking wrong
   number* (the crossed-out original price, which still matches a naive
   regex).

## Reliability mechanics

- **Retry with backoff, not retry-forever.** Each scrape attempt (option
  select → hover-unlock → reveal click → wait for price) is wrapped in up to
  4 attempts with exponential backoff (1s/2s/4s/8s). A run that needed
  retries is recorded as `retried`, not silently as `success` — the scrape
  log is meant to reflect what actually happened, including friction, not
  just the end result.
- **Wait for state, not time.** Every wait in the scraper is tied to an
  actual condition (a button becoming enabled, a specific text pattern
  appearing) rather than a fixed `sleep()`. This is what let the retry logic
  survive both the async price-reveal delay and the genuinely flaky
  underlying `quote` call without either racing ahead of a slow load or
  wasting time on a fast one.
- **Never guess on failure.** If all 4 attempts fail, `price` and `stock` are
  written as `null`/empty with an `error_message`, never a stale or
  extrapolated value. Honest gaps in the price history are more useful than
  confident wrong numbers.
- **One product's failure doesn't take down the run.** Each tracked product
  is scraped independently inside the same run; a Supabase write failure or
  a scrape failure for one product is logged and the loop continues to the
  next.

## Trade-offs

- **Playwright over lightweight fetching for the pricing step**, even though
  the assignment favors lightweight fetching where possible. This was a
  deliberate choice, not a default: the WASM/blob obfuscation makes direct
  API access impractical without reverse-engineering a crypto scheme that
  the store owner clearly doesn't want scraped, whereas driving the real UI
  is both simpler and more robust to that layer changing in the future.
- **Simulated mouse jitter instead of a single hover event**, adding a small
  amount of real time (up to a few seconds) to every scrape, in exchange for
  actually working — a single `.hover()` call left the button permanently
  disabled in testing.
- **One combined stock regex covering several known phrasings**
  (`LAST FEW: N`, `SOLD OUT`, `AVAILABLE (N)`, `READY TO SHIP · N AVAILABLE`)
  rather than a single fixed pattern — discovered by literally dumping full
  page text to the terminal across multiple different products rather than
  assuming one wording holds everywhere.

## What my AI tooling got wrong on the first attempt, and how I corrected it

I used Claude throughout to help design and debug this project. Several of
its first-pass assumptions were wrong in ways that only showed up once
tested against the real, live store rather than reasoned about in the
abstract:

1. **It initially assumed the store's price/stock selectors could be
   guessed or inferred without inspection**, and wrote placeholder CSS
   selectors as a starting scaffold. These never matched anything real. The
   fix was procedural, not just technical: actually opening devtools,
   inspecting real elements, and feeding exact text/structure back in,
   rather than trusting a plausible-looking guess.
2. **It assumed a single `.hover()` call was equivalent to sustained
   hovering.** The first working version of the scraper hung for the full
   30-second default timeout because the reveal button never actually
   became enabled. This only surfaced by looking at Playwright's own
   verbose error log, which showed the exact resolved DOM node and its
   `disabled` attribute — the fix (simulated mouse jitter over several
   seconds) came directly from that diagnostic detail, not from re-guessing.
3. **It missed a curly-vs-straight apostrophe mismatch.** A hardcoded string
   `"Check today's price"` never matched the real button, whose accessible
   name used a typographic apostrophe (`’`). The regex used earlier in the
   same function happened to use a wildcard character in that position and
   therefore worked — the fix was to reuse that same regex-based locator for
   the click instead of introducing a second, hardcoded string.
4. **It produced a scraper that reported false successes.** Before the
   zero-width-character issue was found, the scraper was returning
   `outcome=success` with a real-looking number — but it was consistently
   the crossed-out *original* price, not the actual current price, because
   the real price's digits were invisible-character-obfuscated and simply
   didn't match the regex at all, leaving the original as the only (wrong)
   match. This is the failure mode I was most concerned about, since it
   doesn't look like a bug — it looks like a working scraper. It was only
   caught by dumping the full raw page text to the terminal and comparing it
   character-by-character against what was actually being parsed.
5. **It wrote a Windows-incompatible npm script and a Windows-incompatible
   "is this the entrypoint" check**, both of which failed completely silently
   (no error, no output, exit code 0) rather than throwing anything
   diagnosable. These were only found by systematically isolating the
   problem — checking the exit code, running a trivial `node -e` sanity
   check, then running the target script directly outside of `npm run` —
   which narrowed it down to a path-format comparison that behaves
   differently between POSIX and Windows path/URL conventions. Fixed with
   `cross-env` for the npm script and `fileURLToPath` + `path.resolve` for
   the entrypoint check.

The common thread across all five: none of these were caught by reasoning
about the code in isolation. Every one only surfaced by actually running the
scraper against the live target and reading its real output — errors,
timeouts, and (in the most dangerous case) a plausible-but-wrong result —
closely enough to notice the mismatch.
