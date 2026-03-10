import {
  requireSuperAdmin,
  superAdminExportTenantEnv
} from '@/lib/server/runtime';
import { respond, handleError, respondOptions } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request) {
  return respondOptions(request);
}

export async function GET(request, { params }) {
  try {
    await requireSuperAdmin(request);
    const { searchParams } = new URL(request.url);
    const customDomain = searchParams.get('customDomain') || '';
    const payload = await superAdminExportTenantEnv(params.key, { customDomain });
    return respond(payload, {}, request);
  } catch (err) {
    return handleError(err, request);
  }
}
