/**
 * GET /api/profile — get current user's profile + wallet + preferences
 * PATCH /api/profile — update profile fields
 */
import { z } from 'zod';
import { withApi, prisma, requireSession, validateUsername } from '@pazzera/core';
import { ValidationError, AppError } from '@pazzera/core';

const PatchBody = z.object({
  username: z.string().min(3).max(20).optional(),
  displayName: z.string().max(60).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  preferences: z
    .object({
      emailNotifications: z.boolean().optional(),
      paymentToasts: z.boolean().optional(),
      fraudAlerts: z.boolean().optional(),
    })
    .optional(),
});

export const GET = withApi(async () => {
  const session = await requireSession();
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        email: true,
        isArtist: true,
        role: true,
      },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { address: true, status: true, provider: true, custody: true },
    }),
  ]);
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
  return new Response(
    JSON.stringify({
      ...user,
      wallet,
      preferences: {
        emailNotifications: true,
        paymentToasts: true,
        fraudAlerts: true,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});

export const PATCH = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof PatchBody>>(req);

    if (body.username) {
      const v = validateUsername(body.username);
      if (!v.ok) throw new ValidationError((v as { reason: string }).reason);
      const conflict = await prisma.user.findFirst({
        where: { username: v.value, NOT: { id: session.userId } },
        select: { id: true },
      });
      if (conflict) throw new ValidationError('Username is already taken');
    }

    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: {
        ...(body.username ? { username: body.username } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      },
      select: { username: true, displayName: true, bio: true, avatarUrl: true },
    });
    return new Response(JSON.stringify({ ok: true, user: updated }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
  { requireAuth: true, requireCsrf: true, bodySchema: PatchBody },
);