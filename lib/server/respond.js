import { NextResponse } from 'next/server';
import { HttpError } from './runtime';

function getAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function getCorsHeaders(request) {
  const allowed = getAllowedOrigins();
  const origin = request?.headers?.get?.('origin') || '';
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || 'http://localhost:3000';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-super-admin-key, x-admin-key',
    Vary: 'Origin'
  };
}

function withCors(response, request) {
  const headers = getCorsHeaders(request);
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function respond(data, init = {}, request = null) {
  return withCors(NextResponse.json(data, init), request);
}

function respondOptions(request) {
  return withCors(new NextResponse(null, { status: 204 }), request);
}

function handleError(err, request = null) {
  if (err instanceof HttpError) {
    return withCors(NextResponse.json({ error: err.message }, { status: err.status }), request);
  }
  console.error(err);
  return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), request);
}

export { respond, handleError, respondOptions };
