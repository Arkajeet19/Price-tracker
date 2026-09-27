# Price Tracker — Mock Storefront Scraper

A full-stack app that lets a user search a mock storefront, track a specific
product + option, and watch its price/stock over time via a scheduler that
scrapes the store every 2 hours — built around Playwright, since the store
deliberately obfuscates its pricing behind async UI states and an encrypted
API response.

## Live deployment

- **Live site:** https://price-tracker-six-swart.vercel.app/
- **Backend API:** https://price-tracker-zt32.onrender.com/api
- **GitHub repo:** _add your repo URL here_

## Project structure

```
backend/              Express API + scraper (Node, deployed on Render)
  server.js             API server + /api/cron/scrape endpoint (hit by cron-job.org)
  db.js                 Supabase client
  routes/products.js    search / track / history / logs / CSV export
  scraper/
    scraper.js           per-product scrape logic: option select, price reveal, retries
    search.js            store search via the real listings API (no browser needed)
    runScrape.js         CLI + shared entry point (headless or headed)
frontend/              React + Vite dashboard (deployed on Vercel)
supabase_schema.sql    run this in the Supabase SQL editor first
```

## Setup

### 1. Supabase
- Create a project, run `supabase_schema.sql` in the SQL editor.
- Grab the project URL (Settings → Data API) and the **`sb_secret_...`** key
  (Settings → API Keys → Secret keys). This is the backend-only, full-access
  key — never put it in the frontend.

### 2. Backend
```
cd backend
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npm install
npx playwright install chromium
npm start
```
- `npm run scrape` — run one scrape pass headlessly from the CLI.
- `npm run scrape:headed` — run one pass with a visible browser window (used
  for the submission recording).
- **Deploying to Render:** Root Directory `backend`, Build Command
  `npm install && npx playwright install chromium` (no `--with-deps` — Render's
  build environment rejects the `su` call it requires), Start Command
  `npm start`. Set the same three env vars in Render's Environment tab.

### 3. Frontend
```
cd frontend
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:4000/api for local dev
npm install
npm run dev
```
- **Deploying to Vercel:** Root Directory `frontend`, and set
  `VITE_API_BASE_URL` to your deployed backend's URL **with `/api` on the
  end** (e.g. `https://your-backend.onrender.com/api`). Vite bakes env vars
  in at build time, so redeploy after changing this value for it to take
  effect.

### 4. Scheduling (every 2 hours)
Render's free tier sleeps, so scraping is triggered externally rather than by
an in-process timer:
- Create a free account at [cron-job.org](https://cron-job.org), create a new
  cron job with the URL
  `https://your-backend.onrender.com/api/cron/scrape?token=YOUR_CRON_SECRET`,
  and set the schedule to every 2 hours. This both wakes the sleeping
  instance and runs the scrape.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | backend | Supabase project URL (no `/rest/v1/` suffix) |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Full-access `sb_secret_...` key for writing history (never expose to the frontend) |
| `CRON_SECRET` | backend | Shared secret so only cron-job.org can trigger `/api/cron/scrape` |
| `PORT` | backend | Local dev port (Render sets this itself) |
| `VITE_API_BASE_URL` | frontend | Deployed backend's `/api` base URL |

## How the scraper actually works (confirmed against the live store)

The store is a JS-rendered SPA with no server-side search — search is
implemented by fetching its real listings API (`GET /api/v2/listings?page=N&limit=20`,
48 pages of 20 products) once, caching it, and filtering by name ourselves.

Getting a product's real price/stock, however, requires a full browser,
because the store deliberately obfuscates it:

1. Navigate to `https://demo.inelabteamdev.com/item/{id}`.
2. Click the option button for the variant being tracked (e.g. "Duo",
   "Standard kit") — real `<button>` elements, matched by exact text.
3. A "Price locked" button appears and its label updates to "Check today's
   price" almost immediately — but it stays `disabled` until it detects
   **sustained hovering**. A single synthetic `.hover()` call isn't enough;
   the scraper simulates several seconds of small, continuous mouse jitter
   over the button until `disabled` actually clears.
4. Clicking it triggers a `handshake` + `quote` call under the hood. The
   `quote` response is a WASM proof-of-work challenge plus an encrypted
   `blob` — deliberately un-decodable without replicating the site's own
   crypto. Reverse-engineering that is a dead end; the frontend decodes it
   itself and renders the real price in the DOM, so the scraper just waits
   for that render instead. The `quote` call also fails intermittently
   (observed a real `500 upstream_error`), so the whole click sequence is
   wrapped in a retry loop as a backstop.
5. The real price is shown as a struck-through original figure followed by
   the true current price, with the current price's digits interleaved with
   invisible zero-width characters (`\u200B`–`\u200D`, `\uFEFF`) — specifically
   to break a naive scraper that reads price text directly. The scraper
   strips these before parsing, then takes the **last** ₹ match on the page.
6. Stock is shown in one of several different phrasings depending on the
   product: `LAST FEW: N`, `SOLD OUT`, `AVAILABLE (N)`, `READY TO SHIP · N
   AVAILABLE` — matched via one combined regex.

## Reliability design

- Each scrape attempt retries up to 4 times with exponential backoff
  (1s/2s/4s/8s) before being recorded as `failed`; a run that only succeeded
  after retrying is recorded as `retried`, never silently as `success`.
- The scraper waits for actual state changes (button enabled, price text
  present) rather than fixed sleeps, so it survives the store's async
  behavior without racing it or wasting time.
- On failure, `price`/`stock` are stored as `null` — never a stale or guessed
  value — and `error_message` captures the real cause for debugging.
- A failed Supabase write is logged but never aborts the rest of the run —
  one product's failure shouldn't lose data for the others.
- The scraper is cross-platform: an early version's Windows/PowerShell
  incompatibility (`VAR=value` syntax, and an ESM "is this the entrypoint"
  check that compares path formats that differ between Windows and POSIX)
  was found and fixed during testing.

## What broke on the first pass, and what fixed it

This is the short version of the design note — see the fuller write-up
alongside this README for submission.

1. **Assumed a plain HTTP-fetchable API for pricing.** The store exposes a
   real JSON listings API, which made search easy, but price/stock is
   deliberately locked behind browser-only interaction (hover-to-enable,
   WASM/blob obfuscation) — confirmed by inspecting Network tab traffic
   directly rather than assuming.
2. **Assumed "hover" meant a single event.** The reveal button stayed
   `disabled` after one synthetic hover; fixed by simulating sustained mouse
   movement instead of a single `.hover()` call.
3. **A curly vs. straight apostrophe silently broke a locator.** `"Check
   today's price"` (straight `'`) never matched the real text (curly `’`),
   so the fix was to reuse the same regex-based locator for both waiting and
   clicking instead of a hardcoded string.
4. **The "current price" regex was quietly capturing the wrong number.**
   Zero-width characters interleaved in the real price's digits meant the
   scraper was reporting the crossed-out original price as a false
   "success" — caught by dumping the full page text and comparing it
   character-by-character against what the regex matched.
5. **Windows-only failures didn't reproduce in reasoning about the code.**
   The `HEADED=true node ...` npm script and the ESM entrypoint check both
   silently failed on Windows/PowerShell without any error message — fixed
   with `cross-env` and a `fileURLToPath`-based comparison respectively.
