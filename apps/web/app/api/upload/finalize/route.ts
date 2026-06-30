/**
 * POST /api/upload/finalize
 *
 * Body: { songId, recipients, priceUsdc }
 *
 * The client calls this once both audio + cover are uploaded.
 * Validates the royalty split, persists recipients + price, then
 * triggers the processing pipeline.
 */
import { z } from 'zod';
import {
  withApi,
  requireSession,
  AppError,
  ValidationError,
  prisma,
} from '@pazzera/core';
import { startProcessing } from '@pazzera/upload/pipeline';

const RecipientSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('internal'),
    username: z.string().min(1).max(40),
    role: z.enum(['primary_artist', 'featured_artist', 'producer', 'songwriter', 'label', 'custom']),
    percentageBps: z.number().int().min(1).max(10000),
  }),
  z.object({
    type: z.literal('external'),
    externalWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    externalLabel: z.string().min(1).max(80),
    username: z.string().min(1).max(40),
    role: z.enum(['primary_artist', 'featured_artist', 'producer', 'songwriter', 'label', 'custom']),
    percentageBps: z.number().int().min(1).max(10000),
  }),
]);

const Body = z.object({
  songId: z.string().min(1),
  priceUsdc: z.string().regex(/^0\.(00[1-9]|0[1-9]\d|[1-9]\d{0,2})$/).refine(
    (v) => Number(v) >= 0.001 && Number(v) <= 0.005,
    { message: 'priceUsdc must be between 0.001 and 0.005' },
  ),
  recipients: z.array(RecipientSchema).min(1).max(10),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);

    const song = await prisma.song.findUnique({
      where: { id: body.songId },
      select: {
        id: true,
        artistId: true,
        audioKey: true,
        coverKey: true,
      },
    });
    if (!song) throw new AppError('NOT_FOUND', 'Song not found', 404);
    if (song.artistId !== session.userId) {
      throw new AppError('FORBIDDEN', 'Not the song owner', 403);
    }
    if (!song.audioKey || song.audioKey === 'pending') {
      throw new ValidationError('Audio not uploaded yet');
    }
    if (!song.coverKey || song.coverKey === 'pending') {
      throw new ValidationError('Cover not uploaded yet');
    }

    const totalBps = body.recipients.reduce((s, r) => s + r.percentageBps, 0);
    if (totalBps !== 10000) {
      throw new ValidationError(`Recipient splits must total 10000 bps, got ${totalBps}`);
    }

    const seenInternal = new Set<string>();
    const seenExternal = new Set<string>();
    for (const r of body.recipients) {
      if (r.type === 'internal') {
        if (seenInternal.has(r.username)) throw new ValidationError(`Duplicate recipient: ${r.username}`);
        seenInternal.add(r.username);
      } else {
        const key = r.externalWalletAddress.toLowerCase();
        if (seenExternal.has(key)) throw new ValidationError(`Duplicate external wallet`);
        seenExternal.add(key);
      }
    }

    const internalUsernames: string[] = [];
    for (const r of body.recipients as { type: string; username: string }[]) {
      if (r.type === 'internal') internalUsernames.push(r.username);
    }
    const users: { id: string; username: string }[] = internalUsernames.length
      ? await prisma.user.findMany({ where: { username: { in: internalUsernames } }, select: { id: true, username: true } })
      : [];
    const userByUsername = new Map<string, { id: string; username: string }>();
    for (const u of users) userByUsername.set(u.username, u);

    await prisma.$transaction([
      prisma.royaltyRecipient.deleteMany({ where: { songId: song.id } }),
      prisma.royaltyRecipient.createMany({
        data: body.recipients.map((r: { username: string; type: 'internal' | 'external'; role: 'producer' | 'custom' | 'primary_artist' | 'featured_artist' | 'songwriter' | 'label'; percentageBps: number; externalWalletAddress?: string; externalLabel?: string }, i: number) => {
          if (r.type === 'internal') {
            const u = userByUsername.get(r.username);
            if (!u) throw new ValidationError(`Unknown Pazzera user: @${r.username}`);
            return {
              songId: song.id,
              userId: u.id,
              username: u.username,
              role: r.role,
              splitPercentageBps: r.percentageBps,
              payoutPriority: 100 + i,
            };
          }
          return {
            songId: song.id,
            userId: null,
            externalWalletAddress: r.externalWalletAddress,
            externalLabel: r.externalLabel,
            username: r.username,
            role: r.role,
            splitPercentageBps: r.percentageBps,
            payoutPriority: 100 + i,
          };
        }),
      }),
      prisma.song.update({
        where: { id: song.id },
        data: { artistPriceUsdc: body.priceUsdc },
      }),
    ]);

    await startProcessing(song.id);

    return new Response(
      JSON.stringify({ ok: true, status: 'processing', songId: song.id }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);