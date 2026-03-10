import { getMessageDetail, resolveProjectFromRequest } from '@/lib/server/runtime';
import { respond, handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    const payload = await getMessageDetail(params.id, projectKey);
    return respond(payload);
  } catch (err) {
    return handleError(err);
  }
}
