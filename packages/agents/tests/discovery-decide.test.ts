import { describe, it, expect } from 'vitest';
import { decideDiscovery, type DiscoveryInput } from '../src/discovery/decide';

const baseInput: DiscoveryInput = {
  userId: 'u1',
  songId: 's1',
  userCfSimilarity: 0.7,
  userCompletionRate: 0.6,
  userReplayCount: 1,
  userWalletSpendAffinity: 0.4,
  artistSimilarity: 0.5,
  trendingVelocity: 0.5,
  daysSinceUpload: 7,
  songCompletionRate: 0.8,
  artistPublishedCount: 8,
  artistTrendingRank: 0.5,
  recentSimilarListen: 0,
};

describe('decideDiscovery', () => {
  it('returns a recommendation with score in 0..1', () => {
    const r = decideDiscovery(baseInput);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(['for_you', 'trending', 'rising_artists', 'because_you_listened']).toContain(r.bucket);
    expect(r.explanation.length).toBeGreaterThan(20);
  });

  it('routes high trendingVelocity to trending bucket', () => {
    const r = decideDiscovery({
      ...baseInput,
      trendingVelocity: 0.95,
      userCfSimilarity: 0.5,
      artistPublishedCount: 8,
      artistTrendingRank: 0.5,
      recentSimilarListen: 0,
    });
    expect(r.bucket).toBe('trending');
  });

  it('routes new artists with low published count + top rank to rising_artists', () => {
    const r = decideDiscovery({
      ...baseInput,
      artistPublishedCount: 1,
      artistTrendingRank: 0.04,
      trendingVelocity: 0.7,
    });
    expect(r.bucket).toBe('rising_artists');
  });

  it('routes recent-listener signal to because_you_listened', () => {
    const r = decideDiscovery({ ...baseInput, recentSimilarListen: 0.9, recentSimilarSongTitle: 'Piano Storm' });
    expect(r.bucket).toBe('because_you_listened');
    expect(r.explanation).toContain('Piano Storm');
  });

  it('signals record is a non-empty object of numeric weights', () => {
    const r = decideDiscovery(baseInput);
    for (const v of Object.values(r.signals)) {
      expect(typeof v).toBe('number');
    }
  });
});