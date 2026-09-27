/**
 * Store product search.
 *
 * The store's homepage grid has no search box, but it's backed by a real
 * paginated JSON API discovered via the Network tab:
 *   GET https://demo.inelabteamdev.com/api/v2/listings?page=N&limit=20
 * (48 pages, 20 items each, 960 products total). No server-side name filter
 * was found, so we fetch all pages once, cache them in memory, and filter by
 * name ourselves -- much simpler and more reliable than driving a browser for
 * every search.
 *
 * Product page URL pattern confirmed from the address bar:
 *   https://demo.inelabteamdev.com/item/{id}
 */

const LISTINGS_URL = 'https://demo.inelabteamdev.com/api/v2/listings';
const PAGE_SIZE = 20;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes -- product catalog is presumably static

let cache = { products: null, fetchedAt: 0 };

async function fetchAllListings() {
  const now = Date.now();
  if (cache.products && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.products;
  }

  const first = await fetchPage(1);
  const all = [...first.results];
  const totalPages = first.totalPages || 1;

  for (let page = 2; page <= totalPages; page++) {
    const { results } = await fetchPage(page);
    all.push(...results);
  }

  cache = { products: all, fetchedAt: now };
  return all;
}

async function fetchPage(page) {
  const res = await fetch(`${LISTINGS_URL}?page=${page}&limit=${PAGE_SIZE}`);
  if (!res.ok) throw new Error(`listings page ${page} -> ${res.status}`);
  return res.json();
}

/**
 * Search the cached catalog for products matching `query` (partial or full
 * name, case-insensitive).
 * Returns [{ storeProductId, name, url, brand, category, sku }]
 */
export async function searchStore(query) {
  const all = await fetchAllListings();
  const q = query.trim().toLowerCase();

  return all
    .filter((p) => p.name.toLowerCase().includes(q))
    .map((p) => ({
      storeProductId: String(p.id),
      name: p.name,
      brand: p.brand,
      category: p.category,
      sku: p.sku,
      url: `https://demo.inelabteamdev.com/item/${p.id}`,
    }));
}
