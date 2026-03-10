import {
  requireSuperAdmin,
  superAdminListSites,
  superAdminUpsertSite
} from '@/lib/server/runtime';
import { respond, handleError, respondOptions } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request) {
  return respondOptions(request);
}

export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    const payload = await superAdminListSites();
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}

export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json();
    const payload = await superAdminUpsertSite(body || {});
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}
