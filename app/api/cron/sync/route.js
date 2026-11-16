import { actorFrom } from '../../../../lib/access';
import { handle } from '../../../../lib/http';
import { rescanLink, rescanSource } from '../../../../lib/rescan';
import { cronAllowed } from '../../../../lib/sync';
import * as wbw from '../../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled re-scan, OFF. Not listed in vercel.json crons, and proxy.js/lib/gate.js still require a session for this path (turning it on
// also means allowing GET /api/cron/sync through the gate; the CRON_SECRET check below then guards it). Turning it on needs Dan's OK: set SYNC_CRON_ENABLED=1 and CRON_SECRET,
// then add { "path": "/api/cron/sync", "schedule": "0 9 * * *" } (Hobby allows once a day). Only sellers with sync = 'auto'
// and a website/Poshmark primary source are re-scanned, one budgeted pass per run.
export const GET = handle(async req => {
  const gate = cronAllowed(req);
  // Off (or no cron secret): only a signed-in user may even see the status; logged out → 401 like every other route.
  if (!gate.ok) { await actorFrom(req); return { enabled: false, reason: gate.reason }; }
  const sellers = (await wbw.getSellers()).filter(s => s.sync === 'auto');
  const out = [];
  const start = Date.now();
  for (const s of sellers) {
    if (Date.now() - start > 240000) break;
    try { rescanLink(s); } catch (e) { out.push({ seller: s.seller, skipped: e.message }); continue; }
    try { out.push({ seller: s.seller, ...(await rescanSource(s.seller, s, wbw, { budgetMs: Math.max(10000, 240000 - (Date.now() - start)) })) }); }
    catch (e) { out.push({ seller: s.seller, error: e.message }); }
  }
  return { enabled: true, ran: out };
});
