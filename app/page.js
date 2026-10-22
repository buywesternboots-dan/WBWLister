'use client';
import { useEffect, useState } from 'react';
import Screen from './screen';
import { homeFor } from '../lib/home';

// Admin interface: every tool on this one screen. A seller session is sent to the seller interface.
export default function AdminHome() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(m => m.role === 'seller' ? location.replace(homeFor('seller')) : setOk(true)).catch(() => setOk(true));
  }, []);
  return ok ? <Screen admin /> : null;
}
