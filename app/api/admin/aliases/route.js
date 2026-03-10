import { adminAliases, requireAdmin, resolveProjectFromRequest } from '@/lib/server/runtime';
import { respond, handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const payload = await adminAliases(projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}
