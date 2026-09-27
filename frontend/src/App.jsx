import { useEffect, useState } from 'react';
import { api } from './api';
import ProductSearch from './components/ProductSearch';
import ProductDashboard from './components/ProductDashboard';
import './styles.css';

export default function App() {
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  function refresh() {
    api.listProducts().then((p) => {
      setProducts(p);
      if (!selectedId && p.length > 0) setSelectedId(p[0].id);
    });
  }

  useEffect(refresh, []);

  const selected = products.find((p) => p.id === selectedId);

  return (
    <div className="app">
      <header>
        <h1>Price Tracker</h1>
        <a href={api.exportUrl()}>
          <button>Export CSV</button>
        </a>
      </header>

      <ProductSearch onTracked={refresh} />

      <div className="layout">
        <ul className="product-list">
          {products.map((p) => (
            <li
              key={p.id}
              className={p.id === selectedId ? 'active' : ''}
              onClick={() => setSelectedId(p.id)}
            >
              {p.product_name} ({p.option_label})
            </li>
          ))}
        </ul>

        {selected && <ProductDashboard product={selected} />}
      </div>
    </div>
  );
}
