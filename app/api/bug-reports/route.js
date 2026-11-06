import { bugReportResponse } from '../../../lib/bugs';
import { insertReport, listReports, readLimit, reporterFor, setStatus, writeLimit } from '../../../lib/bug-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const db = {
  list: listReports,
  insert: insertReport,
  setStatus,
  reporter: reporterFor,
  limits: { read: readLimit, write: writeLimit },
};

export const GET = req => bugReportResponse(req, db);
export const POST = req => bugReportResponse(req, db);
export const PATCH = req => bugReportResponse(req, db);
