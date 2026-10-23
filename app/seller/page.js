'use client';
import { useEffect, useState } from 'react';
import Screen from '../screen';
import { homeFor } from '../../lib/home';

// Seller interface: this seller's items only. Anyone else is sent back to the admin interface.
export default function SellerHome() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(m => {
      if (m?.role === 'seller') setOk(true);
      else location.replace(m?.role === 'admin' ? homeFor('admin') : '/login');
    }).catch(() => location.replace('/login'));
  }, []);
  return ok ? <Screen /> : null;
}
