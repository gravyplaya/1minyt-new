/**
 * OAuth callback — Google redirects here with ?code=... and ?state=...
 *
 * TAV-68: the callback now resolves the Google identity to a user row
 * (findOrCreateUserByGoogleChannel — known user, legacy-owner claim, or
 * brand-new signup), saves that user's tokens, and opens a session cookie.
 * This is the ONLY place sign-in happens; "Connect with Google" and "Sign
 * in" are the same flow.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode, fetchMyChannel } from '@/lib/youtube';
import { saveTokens } from '@/lib/tokens';
import { createSession, findOrCreateUserByGoogleChannel, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * TAV-68i: absolute origin the *client* used to reach this server, derived from
 * proxy headers (correct behind Dokploy/Traefik) — unlike `req.nextUrl`, whose
 * host comes from the socket the container bound (localhost:3000 in prod), not
 * from the Host header. Every browser redirect we issue must use this, or the
 * user lands on localhost.
 *
 * Resolution order:
 *  1. `APP_ORIGIN` env — explicit operator override, wins outright.
 *  2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by Traefik/Cloudflare.
 *  3. `Host` header (+ `X-Forwarded-Proto`, default https in production).
 *  4. `req.nextUrl.origin` — dev / direct access.
 */
function requestOrigin(req: NextRequest): string {
  const override = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '');
  if (override) return override;

  const fwdHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = fwdHost || req.headers.get('host');
  if (host) {
    const proto =
      req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

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
    // Fetch the user's YouTube identity + profile right after we have the
    // access token. The channel id is the TAV-68 user identity — without it
    // we can't create a session, so a failure here IS fatal (unlike the
    // pre-multiuser best-effort profile fetch).
    let profile: Awaited<ReturnType<typeof fetchMyChannel>>;
    try {
      profile = await fetchMyChannel(tokens.access_token);
    } catch {
      return NextResponse.json({
        error: 'Could not determine your YouTube identity. Please try again.',
      }, { status: 400 });
    }
    if (!profile.channelId) {
      return NextResponse.json({
        error: 'Your Google account has no YouTube channel to identify with. Please try again.',
      }, { status: 400 });
    }

    const user = await findOrCreateUserByGoogleChannel(
      profile.channelId,
      profile.displayName ?? null,
      profile.avatarUrl ?? null,
    );
    await saveTokens(user.id, tokens.access_token, tokens.refresh_token, tokens.expiry_date, {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    });
    const session = await createSession(user.id);

    // TAV-68i: redirect to the origin the browser actually used — derived from
    // proxy headers, NOT req.nextUrl (whose host is the container-socket host,
    // sending prod users to http://localhost:3000 after login).
    const res = NextResponse.redirect(new URL('/', requestOrigin(req)));
    res.cookies.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
    });
    res.cookies.delete('oauth_state');
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
