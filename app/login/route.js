import { NextResponse } from 'next/server';
import { generateAuthUrl, resolveProjectFromRequest } from '@/lib/server/runtime';
import { handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const projectKey = resolveProjectFromRequest(request);
    const { url } = await generateAuthUrl(projectKey);
    return NextResponse.redirect(url);
  } catch (err) {
    return handleError(err);
  }
}
