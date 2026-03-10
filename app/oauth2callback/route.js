import { NextResponse } from 'next/server';
import { exchangeCode, resolveProjectFromRequest } from '@/lib/server/runtime';
import { handleError } from '@/lib/server/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const projectKey = resolveProjectFromRequest(request);

  try {
    // Check if user denied access
    if (error) {
      return NextResponse.redirect(new URL('/?error=access_denied', request.url));
    }

    // Check if code is provided
    if (!code) {
      return NextResponse.redirect(new URL('/?error=no_code', request.url));
    }

    await exchangeCode(code, searchParams.get('state'), projectKey);
    
    // Redirect to admin page after successful auth
    return NextResponse.redirect(new URL(`/admin?auth=success&project=${encodeURIComponent(projectKey)}`, request.url));
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(
      new URL(`/admin?project=${encodeURIComponent(projectKey)}&error=${encodeURIComponent(err.message)}`, request.url)
    );
  }
}
