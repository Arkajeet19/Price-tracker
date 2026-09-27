import { Router } from 'express';
import { supabase } from '../db.js';
import { searchStore } from '../scraper/search.js';

export const router = Router();

// GET /api/search?q=partial+name
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query param "q"' });

  try {
    const results = await searchStore(q);
    res.json(results);
  } catch (err) {
    console.error('Search failed:', err);
    res.status(502).json({ error: 'Store search failed', detail: String(err.message || err) });
  }
});

// POST /api/track  { storeProductId, name, optionLabel, url }
router.post('/track', async (req, res) => {
  const { storeProductId, name, optionLabel, url } = req.body || {};
  if (!storeProductId || !name || !optionLabel || !url) {
    return res.status(400).json({ error: 'storeProductId, name, optionLabel and url are required' });
  }

  const { data, error } = await supabase
    .from('tracked_products')
    .insert({
      store_product_id: storeProductId,
      product_name: name,
      option_label: optionLabel,
      product_url: url,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/products — tracked products + latest price
router.get('/products', async (req, res) => {
  const { data: products, error } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const { data: latest } = await supabase.from('latest_price').select('*');
  const latestByProduct = Object.fromEntries((latest || []).map((r) => [r.tracked_product_id, r]));

  res.json(products.map((p) => ({ ...p, latest: latestByProduct[p.id] || null })));
});

// GET /api/products/:id/history — full price/stock history for charting
router.get('/products/:id/history', async (req, res) => {
  const { data, error } = await supabase
    .from('price_history')
    .select('scraped_at, price, stock, outcome')
    .eq('tracked_product_id', req.params.id)
    .order('scraped_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/products/:id/logs — every scrape attempt, most recent first
router.get('/products/:id/logs', async (req, res) => {
  const { data, error } = await supabase
    .from('price_history')
    .select('scraped_at, outcome, attempt_count, error_message, price, stock')
    .eq('tracked_product_id', req.params.id)
    .order('scraped_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/export — CSV of the full scrape history across all products
router.get('/export', async (req, res) => {
  const { data, error } = await supabase
    .from('price_history')
    .select('scraped_at, price, stock, outcome, tracked_products(store_product_id, product_name, option_label)')
    .order('scraped_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const header = 'store_product_id,product_name,option,timestamp_utc,price,stock,outcome\n';
  const rows = (data || []).map((r) => {
    const p = r.tracked_products || {};
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(p.store_product_id),
      esc(p.product_name),
      esc(p.option_label),
      esc(r.scraped_at),
      r.outcome === 'success' || r.outcome === 'retried' ? r.price ?? '' : '',
      r.outcome === 'success' || r.outcome === 'retried' ? esc(r.stock) : '',
      esc(r.outcome),
    ].join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="scrape_history.csv"');
  res.send(header + rows.join('\n'));
});
