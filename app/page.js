'use client';
import { useEffect, useState } from 'react';
import Screen from './screen';
import { homeFor } from '../lib/home';

// Admin interface: every tool on this one screen. A seller session is sent to the seller interface.
export default function AdminHome() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(m => {
      if (m?.role === 'seller') location.replace(homeFor('seller'));
      else if (m?.role === 'admin') setOk(true);
      else location.replace('/login');
    }).catch(() => location.replace('/login'));
  }, []);
  return ok ? <Screen admin /> : null;
}
