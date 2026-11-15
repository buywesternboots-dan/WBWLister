'use client';
import { useEffect, useState } from 'react';
import { applicationsLabel } from '../lib/public-intake-constants';

// Admin-only alert. Shows on every admin page while any seller application is still pending.
export default function ApplicationsBanner() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => fetch('/api/intake-submissions?count=1').then(r => r.ok ? r.json() : null).then(j => setN(j?.pending || 0)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    addEventListener('intake-reviewed', load);
    return () => { clearInterval(t); removeEventListener('intake-reviewed', load); };
  }, []);
  if (!n) return null;
  return (
    <a href="/#applications" className="app-banner" role="status"
      style={{ display: 'block', margin: '0 0 12px', padding: '12px 16px', borderRadius: 8, background: '#a3261b', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
      🔔 {applicationsLabel(n)} — review now →
    </a>
  );
}
