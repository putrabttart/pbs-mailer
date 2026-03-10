import { requireSuperAdmin, superAdminActivity } from '@/lib/server/runtime';
import { respond, handleError, respondOptions } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request) {
  return respondOptions(request);
}

export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '100';
    const payload = await superAdminActivity(limit);
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}
