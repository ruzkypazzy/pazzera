/**
 * POST /api/upload/finalize
 *
 * Body:
 *   {
 *     songId, priceUsdc,
 *     metadata: {
 *       title, artistName (display name), featuredNames: string[],
 *       producerName: string|null, description, durationSeconds,
 *       audioKey, coverKey,
 *     },
 *     recipients: [{
 *       type: 'internal' | 'external',
 *       username, // Pazzera @username for internal; display name for external
 *       displayName, // shown publicly on credits
 *       role: 'primary_artist' | 'featured_artist' | 'producer' | ...,
 *       percentageBps,
 *       externalWalletAddress?, // when type=external
 *       externalLabel?,         // when type=external
 *     }, ...]
 *   }
 *
 * The client calls this once both audio + cover are uploaded.
 * Validates the royalty split, persists recipients + price + metadata,
 * then triggers the processing pipeline.
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

const Role = z.enum([
  'primary_artist',
  'featured_artist',
  'producer',
  'songwriter',
  'label',
  'custom',
]);

const MetadataSchema = z.object({
  title: z.string().min(1).max(120),
  artistName: z.string().min(1).max(60),
  featuredNames: z.array(z.string().min(1).max(60)).default([]),
  producerName: z.string().max(60).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(3600 * 6),
  audioKey: z.string().min(1),
  coverKey: z.string().min(1),
});

const RecipientSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('internal'),
    username: z.string().regex(/^[a-z0-9_]{3,20}$/, 'Pazzera @username must be 3–20 chars, lowercase a–z, 0–9, _'),
    displayName: z.string().min(1).max(60),
    role: Role,
    percentageBps: z.number().int().min(1).max(10000),
  }),
  z.object({
    type: z.literal('external'),
    username: z.string().min(1).max(40),
    displayName: z.string().min(1).max(60),
    externalWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    externalLabel: z.string().min(1).max(80),
    role: Role,
    percentageBps: z.number().int().min(1).max(10000),
  }),
]);

type InternalRecipient = Extract<z.infer<typeof RecipientSchema>, { type: 'internal' }>;
type ExternalRecipient = Extract<z.infer<typeof RecipientSchema>, { type: 'external' }>;

const Body = z.object({
  songId: z.string().min(1),
  priceUsdc: z
    .string()
    .regex(/^0\.(00[1-9]|0[1-9]\d|[1-9]\d{0,2})$/, 'priceUsdc must be in USDC with 3 decimals')
    .refine(
      (v) => Number(v) >= 0.001 && Number(v) <= 0.005,
      { message: 'priceUsdc must be between 0.001 and 0.005' },
    ),
  metadata: MetadataSchema,
  recipients: z.array(RecipientSchema).min(1).max(10),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);

    // ─── Load owner + song ────────────────────────────────────────────
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, displayName: true, isArtist: true },
    });
    if (!me) throw new AppError('UNAUTHORIZED', 'Session user not found', 401);
    if (!me.isArtist) {
      throw new AppError('FORBIDDEN', 'Artist account required to upload music', 403);
    }

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
    if (song.artistId !== me.id) {
      throw new AppError('FORBIDDEN', 'Not the song owner', 403);
    }

    // Audio and cover must already be uploaded by /api/upload/{audio,cover}
    if (!body.metadata.audioKey || body.metadata.audioKey === 'pending') {
      throw new ValidationError('Audio not uploaded yet');
    }
    if (!body.metadata.coverKey || body.metadata.coverKey === 'pending') {
      throw new ValidationError('Cover not uploaded yet');
    }
    if (song.audioKey !== body.metadata.audioKey) {
      throw new ValidationError('audioKey mismatch — re-upload the audio file');
    }
    if (song.coverKey !== body.metadata.coverKey) {
      throw new ValidationError('coverKey mismatch — re-upload the cover art');
    }

    // ─── Recipient uniqueness + percentage sanity ─────────────────────
    const totalBps = body.recipients.reduce((s, r) => s + r.percentageBps, 0);
    if (totalBps !== 10000) {
      throw new ValidationError(
        `Recipient splits must total 10000 bps (100%); got ${totalBps}`,
      );
    }

    const seenInternal = new Set<string>();
    const seenExternal = new Set<string>();
    let primaryCount = 0;
    for (const r of body.recipients as { type: string; role?: string; username?: string; externalWalletAddress?: string }[]) {
      if (r.role === 'primary_artist') primaryCount += 1;
      if (r.type === 'internal') {
        const k = `${r.username}::${r.role}`;
        if (seenInternal.has(k)) {
          throw new ValidationError(
            `Duplicate recipient: @${r.username} as ${r.role}`,
          );
        }
        seenInternal.add(k);
      } else {
        const k = (r.externalWalletAddress ?? '').toLowerCase();
        if (seenExternal.has(k)) {
          throw new ValidationError('Duplicate external wallet address');
        }
        seenExternal.add(k);
      }
    }
    if (primaryCount === 0) {
      throw new ValidationError('At least one recipient must be the primary artist');
    }
    if (primaryCount > 1) {
      throw new ValidationError('Only one recipient may be the primary artist');
    }

    const internalUsernames = Array.from(
      new Set<string>(
        body.recipients
          .filter((r) => (r as { type?: string }).type === 'internal')
          .map((r) => (r as { username: string }).username),
      ),
    );

    const users = internalUsernames.length
      ? await prisma.user.findMany({
          where: { username: { in: internalUsernames } },
          select: { id: true, username: true },
        })
      : [];
    const userByUsername = new Map<string, { id: string; username: string }>();
    for (const u of users) userByUsername.set(u.username, u);

    for (const r of body.recipients) {
      if (r.type === 'internal') {
        if (!userByUsername.has(r.username)) {
          throw new ValidationError(
            `Unknown Pazzera user: @${r.username} — they need a Pazzera account before you can split royalties to them`,
          );
        }
      }
    }

    // ─── Persist metadata + recipients in one transaction ─────────────
    await prisma.$transaction([
      prisma.song.update({
        where: { id: song.id },
        data: {
          title: body.metadata.title,
          artistName: body.metadata.artistName,
          artistUsername: me.username,
          featuredNames: body.metadata.featuredNames,
          producerName: body.metadata.producerName ?? null,
          description: body.metadata.description ?? null,
          durationSeconds: body.metadata.durationSeconds,
          audioKey: body.metadata.audioKey,
          coverKey: body.metadata.coverKey,
          artistPriceUsdc: body.priceUsdc,
        },
      }),
      prisma.royaltyRecipient.deleteMany({ where: { songId: song.id } }),
      prisma.royaltyRecipient.createMany({
        data: body.recipients.map((r: z.infer<typeof RecipientSchema>, i: number) => {
          if (r.type === 'internal') {
            const u = userByUsername.get(r.username)!;
            return {
              songId: song.id,
              userId: u.id,
              username: r.displayName,
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
            username: r.displayName,
            role: r.role,
            splitPercentageBps: r.percentageBps,
            payoutPriority: 100 + i,
          };
        }),
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
