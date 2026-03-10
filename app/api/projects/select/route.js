import { NextResponse } from 'next/server';
import { listProjectsWithStatus } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const selected = String(body?.project || '').trim().toLowerCase();
    const payload = await listProjectsWithStatus();
    const valid = payload.projects.find((p) => p.key === selected);
    const projectKey = valid ? valid.key : payload.defaultProject;

    const response = NextResponse.json({ ok: true, projectKey });
    response.cookies.set('tmail_project', projectKey, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
