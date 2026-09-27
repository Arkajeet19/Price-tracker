# Price Tracker — Mock Storefront Scraper

Full-stack app that lets a user search the mock storefront (https://demo.inelabteamdev.com/),
track a specific product + option, and watch its price/stock over time via a scheduled scraper.

## Before you run anything

The store is a JavaScript-rendered SPA (a plain HTTP fetch of the homepage returns almost no
content), so the scraper is built around Playwright. **You still need to fill in the real
selectors** — open the store in a browser, use devtools to inspect:

1. The search box and how results render (`backend/scraper/search.js` → `SELECTORS`)
2. A product page's price/stock elements and option picker (`backend/scraper/scraper.js` → `SELECTORS`)
3. **Check the Network tab first** — if the store has an underlying JSON API, hit that directly
   instead of scraping the DOM. It'll be far more reliable and is what the assignment's
   "prefer lightweight fetching" guidance is pointing at.
4. The product page URL pattern, to fix `extractProductId()` in `search.js`.

Everything marked `TODO` in those two files needs a real value before the scraper will work
against the live store.

## Project structure

```
backend/            Express API + scraper (Node, deploy to Render)
  server.js          API server + /api/cron/scrape endpoint
  db.js              Supabase client
  routes/products.js  search / track / history / logs / CSV export
  scraper/
    scraper.js        per-product scrape logic: retries, backoff, async-content waits
    search.js          store search (fill in selectors)
    runScrape.js        CLI + shared entry point (headless or headed)
frontend/           React + Vite dashboard (deploy to Vercel)
supabase_schema.sql  run this in the Supabase SQL editor first
```

## Setup

### 1. Supabase
- Create a project, run `supabase_schema.sql` in the SQL editor.
- Grab the project URL and the **service role** key (Settings → API).

### 2. Backend
```
cd backend
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npm install
npx playwright install chromium
npm start
```
- `npm run scrape` — run one scrape pass headlessly from the CLI.
- `npm run scrape:headed` — run one pass with a visible browser window (use this for the
  submission recording).
- Deploy to Render as a Web Service (`npm start`), set the same env vars there.

### 3. Frontend
```
cd frontend
cp .env.example .env   # VITE_API_BASE_URL → your deployed backend's /api URL
npm install
npm run dev
```
Deploy to Vercel; set `VITE_API_BASE_URL` as an environment variable there too.

### 4. Scheduling (every 2 hours)
Render's free tier sleeps, so scraping is triggered externally rather than by an in-process
timer:
- Create a cron job at [cron-job.org](https://cron-job.org) hitting:
  `GET https://your-backend.onrender.com/api/cron/scrape?token=YOUR_CRON_SECRET`
  every 2 hours. This both wakes the sleeping instance and runs the scrape.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Full-access key for writing history (never expose to the frontend) |
| `CRON_SECRET` | backend | Shared secret so only cron-job.org can trigger `/api/cron/scrape` |
| `PORT` | backend | Local dev port (Render sets this itself) |
| `VITE_API_BASE_URL` | frontend | Deployed backend's `/api` base URL |

## Reliability notes (design note draft — expand this after real testing)

- Each scrape attempt retries up to 4 times with exponential backoff (1s/2s/4s/8s) before being
  recorded as `failed`; a run that only succeeded after retrying is recorded as `retried`, never
  silently as `success`.
- The scraper waits for a specific "price is present" selector rather than a fixed sleep, so it
  survives the store's async-loaded content without either racing it or wasting time.
- On failure, `price`/`stock` are stored as `null`/empty — never a stale or guessed value — and
  `error_message` captures the real cause for debugging.
- A failed Supabase write is logged but never aborts the rest of the run — one product's failure
  shouldn't lose data for the others.
- Still TODO: real selectors (see top of this file), and testing against the actual store's
  slow/error injection to confirm the timeout/retry values are well-tuned.
