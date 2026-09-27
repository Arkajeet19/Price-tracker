const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

async function request(path, opts) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export const api = {
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  track: (body) => request('/track', { method: 'POST', body: JSON.stringify(body) }),
  listProducts: () => request('/products'),
  history: (id) => request(`/products/${id}/history`),
  logs: (id) => request(`/products/${id}/logs`),
  exportUrl: () => `${BASE_URL}/export`,
};
