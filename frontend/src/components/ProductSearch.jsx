import { useState } from 'react';
import { api } from '../api';

export default function ProductSearch({ onTracked }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [optionLabel, setOptionLabel] = useState('');

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      setResults(await api.search(query));
    } catch (err) {
      alert('Search failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(product) {
    const option = optionLabel.trim() || 'default';
    try {
      await api.track({
        storeProductId: product.storeProductId,
        name: product.name,
        optionLabel: option,
        url: product.url,
      });
      onTracked?.();
      setResults([]);
      setQuery('');
    } catch (err) {
      alert('Tracking failed: ' + err.message);
    }
  }

  return (
    <div className="card">
      <h2>Search products</h2>
      <form onSubmit={handleSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Partial or full product name…"
        />
        <input
          value={optionLabel}
          onChange={(e) => setOptionLabel(e.target.value)}
          placeholder="Option to track (e.g. 128GB) — optional"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.url}>
              <span>{r.name}</span>
              <button onClick={() => handleTrack(r)}>Track</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
