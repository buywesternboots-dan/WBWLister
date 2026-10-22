'use client';
import { useEffect, useState } from 'react';
import Screen from '../screen';
import { homeFor } from '../../lib/home';

// Seller interface: this seller's items only. Anyone else is sent back to the admin interface.
export default function SellerHome() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(m => m.role === 'seller' ? setOk(true) : location.replace(homeFor('admin'))).catch(() => location.replace(homeFor('admin')));
  }, []);
  return ok ? <Screen /> : null;
}
