/**
 * Database seed — for development and demo. NOT for production.
 *
 * Creates:
 *   - 1 admin user
 *   - 4 sample artists (Pazzera usernames) with wallets
 *   - 1 multi-recipient song example (5-way split) for the demo
 *   - 4 simple single-recipient songs
 *   - 1 listener with wallet
 *
 * All songs start at status=published + isPublic=true so the UI has
 * something to show without running the full upload → curator pipeline.
 *
 * Idempotent: re-running upserts everything. Wallet private keys here
 * are derived from a deterministic seed so dev environments are stable.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

function deterministicKey(label: string): `0x${string}` {
  const h = createHash('sha256').update(`pazzera-dev-${label}`).digest('hex');
  return `0x${h}` as `0x${string}`;
}

function addressFromKey(key: `0x${string}`): `0x${string}` {
  // Address is the last 20 bytes of keccak256(publicKey) — but for the seed
  // we use a simpler stable mapping: last 40 hex chars of the key hash.
  const h = createHash('sha256').update(key).digest('hex');
  return `0x${h.slice(24)}` as `0x${string}`;
}

const USERS = [
  { email: 'admin@pazzera.com',     username: 'admin',     displayName: 'Admin',         role: 'admin'   },
  { email: 'ada@pazzera.com',       username: 'ada',       displayName: 'Ada Lovelace',  role: 'artist'   },
  { email: 'pete@pazzera.com',      username: 'pixel_pete', displayName: 'Pixel Pete',   role: 'artist'   },
  { email: 'tunde@pazzera.com',     username: 'tunde',     displayName: 'Tunde Adebayo', role: 'artist'   },
  { email: 'claire@pazzera.com',    username: 'claire',    displayName: 'Claire Diaz',   role: 'artist'   },
  { email: 'listener@pazzera.com',  username: 'listener',  displayName: 'Listener',      role: 'listener' },
];

async function ensureUser(u: (typeof USERS)[number]) {
  const user = await prisma.user.upsert({
    where: { email: u.email },
    create: { ...u, isArtist: u.role === 'artist' },
    update: { ...u, isArtist: u.role === 'artist' },
  });

  // Provision a wallet for every user (dev: deterministic)
  const existing = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!existing) {
    const pk = deterministicKey(`wallet-${user.id}`);
    // Dev-only: store a recognizable fake blob. Phase 4 will replace with real AES-GCM.
    const blob = JSON.stringify({
      v: 1,
      c: Buffer.from(pk.slice(2), 'hex').toString('base64'),
      t: 'AAAAAAAAAAAAAAAAAAAAAA==',
      i: 'AAAAAAAAAAAAAAAAAAAAAA==',
      __dev: true,
    });
    await prisma.wallet.create({
      data: {
        userId: user.id,
        address: addressFromKey(pk),
        encryptedPrivateKey: blob,
        status: 'active',
        balanceUsdc: '1000000', // 1 USDC for demo
      },
    });
  }
  return user;
}

async function seed() {
  console.log('seed:start');

  const users = await Promise.all(USERS.map(ensureUser));
  const byUsername = new Map(users.map((u) => [u.username, u]));

  const ada = byUsername.get('ada')!;
  const pete = byUsername.get('pixel_pete')!;
  const tunde = byUsername.get('tunde')!;
  const claire = byUsername.get('claire')!;

  // ─── The showcase multi-recipient song ─────────────────────────
  const showcaseSlug = 'midnight-protocol-ada-feat-tunde-claire';

  const showcase = await prisma.song.upsert({
    where: { slug: showcaseSlug },
    create: {
      slug: showcaseSlug,
      title: 'Midnight Protocol',
      artistId: ada.id,
      artistName: 'Ada Lovelace',
      artistUsername: 'ada',
      featuredNames: ['Tunde Adebayo', 'Claire Diaz'],
      producerName: 'BeatsByNeo (external)',
      description:
        'A 4-minute deep-house cut featuring Lagos-rooted percussion. Mastered at 24-bit / 48 kHz, peaks at -1.2 dBFS.',
      coverKey: 'seed/midnight-protocol-cover.jpg',
      coverUrl: 'https://placehold.co/600x600/0a0a0a/9be15d?text=Midnight+Protocol',
      audioKey: 'seed/midnight-protocol.mp3',
      audioUrl: 'https://placehold.co/audio.mp3',
      durationSeconds: 240,
      audioBitrateKbps: 320,
      audioSampleRateHz: 48000,
      audioChannels: 2,
      audioPeakDb: -1.2,
      artistPriceUsdc: '0.004',
      publishedPriceUsdc: '0.004',
      curatorStatus: 'approved',
      curatorScoreTotal: 84,
      curatorScoreMetadata: 18,
      curatorScoreAudio: 18,
      curatorScoreSpam: 20,
      curatorScoreDuplicate: 20,
      curatorScoreMarket: 8,
      curatorReasons: ['All checks passed'],
      curatorReviewedAt: new Date(),
      status: 'published',
      isPublic: true,
      publishedAt: new Date(),
    },
    update: {},
  });

  // 5-way split:
  //   ada (primary_artist)    → 50% — main creative + performance
  //   tunde (featured)        → 20% — featured vocal + percussion
  //   claire (featured)       → 10% — featured synth
  //   external producer label → 15% — BeatsByNeo (externalWalletAddress)
  //   external songwriter     → 5%  — sample clearance (externalWalletAddress)
  await prisma.royaltyRecipient.deleteMany({ where: { songId: showcase.id } });
  await prisma.royaltyRecipient.createMany({
    data: [
      { songId: showcase.id, userId: ada.id,    username: 'ada',    role: 'primary_artist',    splitPercentageBps: 5000, payoutPriority: 100 },
      { songId: showcase.id, userId: tunde.id,  username: 'tunde',  role: 'featured_artist',   splitPercentageBps: 2000, payoutPriority: 110 },
      { songId: showcase.id, userId: claire.id, username: 'claire', role: 'featured_artist',   splitPercentageBps: 1000, payoutPriority: 120 },
      { songId: showcase.id, externalWalletAddress: '0xBeatsByNeo00000000000000000000000000000001', externalLabel: 'BeatsByNeo Productions', username: 'beatsbyneo', role: 'producer',    splitPercentageBps: 1500, payoutPriority: 130 },
      { songId: showcase.id, externalWalletAddress: '0xSampleClear0000000000000000000000000000002', externalLabel: 'SampleClear Inc.',       username: 'sampleclear', role: 'songwriter',  splitPercentageBps: 500,  payoutPriority: 140 },
    ],
  });

  // ─── 4 single-artist demo songs ────────────────────────────────
  const simpleSongs = [
    { slug: 'pixel-dust',       title: 'Pixel Dust',       artist: pete,   duration: 195, price: '0.003' },
    { slug: 'lagos-sunrise',    title: 'Lagos Sunrise',    artist: tunde,  duration: 220, price: '0.003' },
    { slug: 'velvet-static',    title: 'Velvet Static',    artist: claire, duration: 268, price: '0.004' },
    { slug: 'analogue-dreams',  title: 'Analogue Dreams',  artist: ada,    duration: 312, price: '0.005' },
  ];

  for (const s of simpleSongs) {
    const song = await prisma.song.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        title: s.title,
        artistId: s.artist.id,
        artistName: s.artist.displayName ?? s.artist.username,
        artistUsername: s.artist.username,
        featuredNames: [],
        coverKey: `seed/${s.slug}-cover.jpg`,
        coverUrl: `https://placehold.co/600x600/0a0a0a/9be15d?text=${encodeURIComponent(s.title)}`,
        audioKey: `seed/${s.slug}.mp3`,
        audioUrl: 'https://placehold.co/audio.mp3',
        durationSeconds: s.duration,
        audioBitrateKbps: 256,
        audioSampleRateHz: 44100,
        audioChannels: 2,
        audioPeakDb: -3.4,
        artistPriceUsdc: s.price,
        publishedPriceUsdc: s.price,
        curatorStatus: 'approved',
        curatorScoreTotal: 78,
        curatorScoreMetadata: 16,
        curatorScoreAudio: 16,
        curatorScoreSpam: 18,
        curatorScoreDuplicate: 20,
        curatorScoreMarket: 8,
        curatorReasons: [],
        curatorReviewedAt: new Date(),
        status: 'published',
        isPublic: true,
        publishedAt: new Date(),
      },
      update: {},
    });
    await prisma.royaltyRecipient.deleteMany({ where: { songId: song.id } });
    await prisma.royaltyRecipient.create({
      data: {
        songId: song.id,
        userId: s.artist.id,
        username: s.artist.username,
        role: 'primary_artist',
        splitPercentageBps: 10000,
        payoutPriority: 100,
      },
    });
  }

  // ─── Empty SongMetrics + ArtistMetrics rows so dashboards load ─
  const allSongs = await prisma.song.findMany({ select: { id: true, artistId: true } });
  for (const s of allSongs) {
    await prisma.songMetrics.upsert({
      where: { songId: s.id },
      create: { songId: s.id },
      update: {},
    });
  }
  const artists = Array.from(new Set(allSongs.map((s) => s.artistId)));
  for (const artistId of artists) {
    await prisma.artistMetrics.upsert({
      where: { artistId },
      create: { artistId },
      update: {},
    });
  }

  console.log('seed:done', {
    users: users.length,
    songs: allSongs.length,
    recipients: await prisma.royaltyRecipient.count(),
  });
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('seed:fail', err);
    await prisma.$disconnect();
    process.exit(1);
  });