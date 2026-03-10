import { deleteDomain, requireAdmin, resolveProjectFromRequest, updateDomain } from '@/lib/server/runtime';
import { respond, handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request, { params }) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const body = await request.json();
    const payload = await updateDomain(params.name, body || {}, projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const payload = await deleteDomain(params.name, projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}
