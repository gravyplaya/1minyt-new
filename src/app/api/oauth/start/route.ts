/**
 * OAuth start — kicks off the Google consent flow and redirects.
 */
import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/youtube';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = crypto.randomBytes(16).toString('hex');
  const url = buildAuthUrl(state);
  const res = NextResponse.redirect(url);
  // Stash the state in a short-lived cookie so we can validate on callback.
  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return res;
}