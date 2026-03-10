import {
  requireSuperAdmin,
  superAdminDeleteSite,
  superAdminUpsertSite
} from '@/lib/server/runtime';
import { respond, handleError, respondOptions } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request) {
  return respondOptions(request);
}

export async function PUT(request, { params }) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json();
    const payload = await superAdminUpsertSite({ ...(body || {}), key: params.key });
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}

export async function DELETE(request, { params }) {
  try {
    await requireSuperAdmin(request);
    const payload = await superAdminDeleteSite(params.key);
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}
