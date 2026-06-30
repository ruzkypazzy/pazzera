/**
 * POST /api/artist/upgrade
 *
 * Placeholder — listener-to-artist upgrade endpoint.
 *
 * Per Phase 3 spec: scaffold + validation only. Real promotion (isArtist=true,
 * admin approval flow) lands in Phase 5/11.
 *
 * Body: {
 *   stageName: string,
 *   bio: string,
 *   genres: string[],
 *   socialLinks?: { twitter?, instagram?, website?, spotify?, soundcloud? }
 * }
 *
 * Response: 202 { ok: true, status: 'pending_review' }
 */
import { z } from 'zod';
import {
  withApi,
  prisma,
  requireSession,
  getParsedBody,
} from '@pazzera/core';

const Body = z.object({
  stageName: z.string().min(2).max(60),
  bio: z.string().min(20).max(1000),
  genres: z.array(z.string().min(1).max(30)).min(1).max(8),
  socialLinks: z
    .object({
      twitter: z.string().url().optional(),
      instagram: z.string().url().optional(),
      website: z.string().url().optional(),
      spotify: z.string().url().optional(),
      soundcloud: z.string().url().optional(),
    })
    .partial()
    .optional(),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const data = getParsedBody<z.infer<typeof Body>>(req);

    // Mark user intent. Admin review lands in Phase 11.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: session.userId },
        data: { onboardStatus: 'pending' },
      }),
      prisma.artistProfile.upsert({
        where: { userId: session.userId },
        create: {
          userId: session.userId,
          bio: data.bio,
          socialLinks: (data.socialLinks ?? {}) as object,
        },
        update: {
          bio: data.bio,
          socialLinks: (data.socialLinks ?? {}) as object,
        },
      }),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        status: 'pending_review',
        message: 'Your artist application is pending review. We will email you when approved.',
        stageName: data.stageName,
        genres: data.genres,
      }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);