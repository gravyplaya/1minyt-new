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

    const res = NextResponse.redirect(new URL('/', req.nextUrl));
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
