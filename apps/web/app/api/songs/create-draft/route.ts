/**
 * POST /api/songs/create-draft
 * Creates a Song row in 'draft' status with the provided metadata.
 * Returns { songId, slug, status }.
 */
import { z } from 'zod';
import {
  withApi,
  requireSession,
  AppError,
  prisma,
} from '@pazzera/core';

const Body = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional().nullable(),
  genre: z.string().max(40).optional().nullable(),
  language: z.string().max(40).optional().nullable(),
});

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'song';
}

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);

    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, isArtist: true, username: true, displayName: true },
    });
    if (!me?.isArtist) {
      throw new AppError('FORBIDDEN', 'Artist account required to upload music', 403);
    }

    // Make a unique slug
    let slug = slugify(body.title);
    for (let i = 0; i < 6; i++) {
      const exists = await prisma.song.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `${slugify(body.title)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const song = await prisma.song.create({
      data: {
        slug,
        title: body.title,
        description: body.description ?? null,
        artistId: me.id,
        artistName: me.displayName ?? me.username,
        artistUsername: me.username,
        // Placeholders — populated by upload pipeline
        coverKey: 'pending',
        coverUrl: '',
        audioKey: 'pending',
        audioUrl: '',
        durationSeconds: 0,
        artistPriceUsdc: '0.003',
        status: 'draft',
      },
      select: { id: true, slug: true, status: true },
    });

    return new Response(JSON.stringify({ ok: true, ...song }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);