/**
 * OAuth callback — Google redirects here with ?code=... and ?state=...
 */
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode } from '@/lib/youtube';
import { saveTokens } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const cookieState = req.cookies.get('oauth_state')?.value;

  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: 'state mismatch' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      return NextResponse.json({
        error: 'No refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and try again.',
      }, { status: 400 });
    }
    await saveTokens('me', tokens.access_token, tokens.refresh_token, tokens.expiry_date);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const res = NextResponse.redirect(new URL('/', req.nextUrl));
  res.cookies.delete('oauth_state');
  return res;
}