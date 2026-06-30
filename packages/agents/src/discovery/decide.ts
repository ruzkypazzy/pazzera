/**
 * Discovery Agent — pure scoring function for the recommendation engine.
 *
 * Phase 7: real hybrid recommendation model replacing the Phase 5 no-op.
 *
 *   Score = w_cf * CF_similarity
 *         + w_cmp * user_completion_rate (avg over songs similar to candidate)
 *         + w_replay * replay_volume
 *         + w_wallet * wallet_spend_history (paying = interest)
 *         + w_artist * artist_similarity (shared listeners)
 *         + w_trend * trending_velocity (rolling-7d streams delta)
 *         + w_fresh * freshness (newer songs get a push if quality is good)
 *
 * Bucket assignment:
 *   - because_you_listened: when the strongest signal is "you completed
 *     a similar song"
 *   - for_you: general personalized feed (default)
 *   - trending: when trending_velocity dominates (>0.4 contribution)
 *   - rising_artists: candidate artist has <5 published songs AND
 *     listen velocity is in top 10%
 *
 * The function takes a normalized candidate + signal inputs and returns
 * a Recommendation with the score, bucket, and a one-line explanation
 * the UI can show verbatim.
 */
import type { Recommendation } from '@pazzera/core';

export interface DiscoveryInput {
  userId: string;
  songId: string;
  // user-vs-other-users collaborative filtering similarity (0..1)
  userCfSimilarity: number;
  // average completion rate the user has for songs similar to this one (0..1)
  userCompletionRate: number;
  // cumulative replay count this user has for similar songs (0..∞)
  userReplayCount: number;
  // the user's wallet-spend-per-stream z-score normalized (0..1)
  userWalletSpendAffinity: number;
  // artist-pair similarity (jaccard of shared listeners vs user's ears, 0..1)
  artistSimilarity: number;
  // Rolling-7d stream velocity in standard deviations (0..1)
  trendingVelocity: number;
  // Days since upload (0 = today; older = lower)
  daysSinceUpload: number;
  // Song's lifetime completion rate (avg across listeners)
  songCompletionRate: number;
  // Number of published songs by this song's artist
  artistPublishedCount: number;
  // Rank of the artist among trending-artist-leaderboard (0..1; 0 = top)
  artistTrendingRank: number;
  // Did the user listen to a similar song recently? (0..1)
  recentSimilarListen: number;
  // Optional text of the listener's most recent similar song
  recentSimilarSongTitle?: string;
}

const WEIGHTS = {
  cf: 0.20,
  completion: 0.16,
  replay: 0.07,
  wallet: 0.10,
  artist: 0.10,
  trend: 0.22,
  fresh: 0.08,
  recentListen: 0.07,
} as const;

const TRENDING_THRESHOLD = 0.15;
const FRESHNESS_BONUS_DAYS = 14;

export function decideDiscovery(input: DiscoveryInput): Recommendation {
  const freshScore = Math.max(0, 1 - input.daysSinceUpload / 90);
  const w = WEIGHTS;
  const components = {
    cf: w.cf * input.userCfSimilarity,
    completion: w.completion * input.userCompletionRate,
    replay: w.replay * Math.min(1, input.userReplayCount / 5),
    wallet: w.wallet * input.userWalletSpendAffinity,
    artist: w.artist * input.artistSimilarity,
    trend: w.trend * input.trendingVelocity,
    fresh: w.fresh * freshScore,
    recentListen: w.recentListen * input.recentSimilarListen,
  };
  const scoreRaw = Object.values(components).reduce((s, n) => s + n, 0);

  // Bucket assignment
  let bucket: Recommendation['bucket'];
  let explanation: string;

  const contributor = Object.entries(components).sort((a, b) => b[1] - a[1])[0]!;

  // Trending takes priority if trending dominates
  if (components.trend >= TRENDING_THRESHOLD && components.trend > components.cf && input.trendingVelocity > 0.7) {
    bucket = 'trending';
    explanation = `Trending: streams up ${(input.trendingVelocity * 100).toFixed(0)}% over the rolling 7d window.`;
  } else if (input.artistPublishedCount < 5 && input.artistTrendingRank < 0.10) {
    bucket = 'rising_artists';
    explanation = `Rising artist: only ${input.artistPublishedCount} published song(s), top ${(input.artistTrendingRank * 100).toFixed(0)}% of trending artists this week.`;
  } else if (components.recentListen > 0.05) {
    bucket = 'because_you_listened';
    const t = input.recentSimilarSongTitle ? `"${input.recentSimilarSongTitle}"` : 'a similar song';
    explanation = `You completed ${(input.userCompletionRate * 100).toFixed(0)}% of songs like this; e.g. ${t}.`;
  } else {
    bucket = 'for_you';
    const dom = contributor[0];
    if (dom === 'cf') {
      explanation = `Users with similar taste completed ${(input.songCompletionRate * 100).toFixed(0)}% of this song.`;
    } else if (dom === 'completion') {
      explanation = `You average ${(input.userCompletionRate * 100).toFixed(0)}% on songs like this.`;
    } else if (dom === 'fresh') {
      explanation = `New release in a genre you engage with.`;
    } else if (dom === 'wallet') {
      explanation = `Your wallet has supported songs in this style — this one fits.`;
    } else if (dom === 'artist') {
      explanation = `You already listen to artists that share listeners with this one.`;
    } else {
      explanation = `Best personalized match in your feed right now.`;
    }
  }

  return {
    songId: input.songId,
    score: Math.round(scoreRaw * 100) / 100,
    bucket,
    explanation,
    signals: components,
  };
}
