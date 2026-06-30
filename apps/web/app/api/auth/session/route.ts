/**
 * GET /api/auth/session
 *
 * Returns the current user, wallet state, and (if new) whether the wallet
 * is still provisioning. Used by the client to render the post-login UX.
 */
import { withApi, getCurrentSession, prisma } from '@pazzera/core';

export const GET = withApi(async () => {
  const session = await getCurrentSession();
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        role: true,
        isArtist: true,
        avatarUrl: true,
      },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { address: true, status: true, balanceUsdc: true, pendingUsdc: true },
    }),
  ]);
  if (!user) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
  }
  return new Response(
    JSON.stringify({
      authenticated: true,
      user,
      wallet,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});