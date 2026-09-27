import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { api } from '../api';

export default function ProductDashboard({ product }) {
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.history(product.id).then(setHistory);
    api.logs(product.id).then(setLogs);
  }, [product.id]);

  const chartData = history
    .filter((h) => h.price != null)
    .map((h) => ({ time: new Date(h.scraped_at).toLocaleString(), price: h.price }));

  return (
    <div className="card">
      <h3>
        {product.product_name} — {product.option_label}
      </h3>
      <p>
        Latest: {product.latest ? `₹${product.latest.price} · ${product.latest.stock}` : 'no data yet'}
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" hide />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip />
          <Line type="monotone" dataKey="price" dot={false} />
        </LineChart>
      </ResponsiveContainer>

      <h4>Scrape log</h4>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Outcome</th>
            <th>Attempts</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={i} className={l.outcome}>
              <td>{new Date(l.scraped_at).toLocaleString()}</td>
              <td>{l.outcome}</td>
              <td>{l.attempt_count}</td>
              <td>{l.price ?? '—'}</td>
              <td>{l.stock ?? '—'}</td>
              <td>{l.error_message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
