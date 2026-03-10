import { addDomain, adminDomains, requireAdmin, resolveProjectFromRequest } from '@/lib/server/runtime';
import { respond, handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const payload = await adminDomains(projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    await requireAdmin(request, projectKey);
    const body = await request.json();
    const payload = await addDomain(body.name || '', projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}
