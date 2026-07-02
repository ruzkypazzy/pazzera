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
 *       // one of three types:
 *       // - 'internal'   = Pazzera user, splits royalties
 *       // - 'external'   = 0x wallet, splits royalties
 *       // - 'credit_only'= name only (e.g. paid outright upstream),
 *       //                  0% split; appears in featuredNames / producerName
 *       type: 'internal' | 'external' | 'credit_only',
 *       username?,         // Pazzera @username for internal; ignored for credit_only
 *       displayName,       // shown publicly on credits
 *       role: 'primary_artist' | 'featured_artist' | 'producer' | ...,
 *       percentageBps,     // 0 for credit_only
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
import { getStorageService } from '@pazzera/storage';
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
  // Credit-only: name goes into featuredNames / producerName. No payout.
  z.object({
    type: z.literal('credit_only'),
    displayName: z.string().min(1).max(60),
    role: Role,
    percentageBps: z.literal(0),
  }),
]);

type InternalRecipient = {
  type: 'internal';
  username: string;
  displayName: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  percentageBps: number;
};
type ExternalRecipient = {
  type: 'external';
  username: string;
  displayName: string;
  externalWalletAddress: string;
  externalLabel: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  percentageBps: number;
};
type CreditOnlyRecipient = {
  type: 'credit_only';
  displayName: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  percentageBps: 0;
};

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
    // The split total is over PAID recipients only — credit_only rows
    // don't share the 100%, they're public credits only.
    const paidRecipients = body.recipients.filter((r) => r.type !== 'credit_only');
    const totalBps = paidRecipients.reduce(
      (s: number, r) => s + (r.percentageBps as number),
      0,
    );
    if (totalBps !== 10000) {
      throw new ValidationError(
        `Royalty splits must total 10000 bps (100%) across paid recipients; got ${totalBps}. Adjust percentages or mark credits as "credit only" if you've already paid them outright.`,
      );
    }

    const seenInternal = new Set<string>();
    const seenExternal = new Set<string>();
    let primaryCount = 0;
    for (const r of paidRecipients) {
      if (r.role === 'primary_artist') primaryCount += 1;
      if (r.type === 'internal') {
        const k = `${r.username}::${r.role}`;
        if (seenInternal.has(k)) {
          throw new ValidationError(
            `Duplicate recipient: @${r.username} as ${r.role}`,
          );
        }
        seenInternal.add(k);
      } else if (r.type === 'external') {
        const k = r.externalWalletAddress.toLowerCase();
        if (seenExternal.has(k)) {
          throw new ValidationError('Duplicate external wallet address');
        }
        seenExternal.add(k);
      }
    }
    if (primaryCount === 0) {
      throw new ValidationError('At least one paid recipient must be the primary artist');
    }
    if (primaryCount > 1) {
      throw new ValidationError('Only one paid recipient may be the primary artist');
    }

    // ─── Resolve internal usernames to user IDs ────────────────────────
    const internalUsernames = Array.from(
      new Set<string>(
        paidRecipients
          .filter((r): r is { type: 'internal'; username: string } & z.infer<typeof RecipientSchema> => (r as { type?: string }).type === 'internal')
          .map((r) => r.username),
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

    for (const r of paidRecipients) {
      if ((r as { type?: string }).type === 'internal') {
        const ir = r as InternalRecipient;
        if (!userByUsername.has(ir.username)) {
          throw new ValidationError(
            `Unknown Pazzera user: @${ir.username} — they need a Pazzera account before you can split royalties to them. Mark them as "Credit only" if you've already paid them outright.`,
          );
        }
      }
    }

    // ─── Persist metadata + paid recipients in one transaction ─────────
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
          audioUrl: await getStorageService().getUrl(body.metadata.audioKey),
          coverKey: body.metadata.coverKey,
          coverUrl: await getStorageService().getUrl(body.metadata.coverKey),
          artistPriceUsdc: body.priceUsdc,
        },
      }),
      prisma.royaltyRecipient.deleteMany({ where: { songId: song.id } }),
      prisma.royaltyRecipient.createMany({
        data: paidRecipients.map((r: z.infer<typeof RecipientSchema>, i: number) => {
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
          if (r.type === 'external') {
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
          }
          // credit_only (defensive — shouldn't reach here as we filtered)
          const cr = r as CreditOnlyRecipient;
          return {
            songId: song.id,
            userId: null,
            externalWalletAddress: null,
            externalLabel: null,
            username: cr.displayName,
            role: cr.role,
            splitPercentageBps: 0,
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
