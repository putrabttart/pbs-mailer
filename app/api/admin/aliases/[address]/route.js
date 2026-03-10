import { deleteAlias, requireAdmin, resolveProjectFromRequest } from '@/lib/server/runtime';
import { respond, handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const payload = await deleteAlias(params.address, projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}
