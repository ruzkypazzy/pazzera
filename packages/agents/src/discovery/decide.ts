/**
 * Discovery Agent — RESERVED.
 *
 * Purpose (post-hackathon):
 *   - Personalized recommendations
 *   - Trending now / this week
 *   - Auto-curated playlists
 *   - Search ranking
 *
 * Architecture reservation only. No decision logic implemented yet.
 * The queue + job payload + enqueue helper exist so other parts of the
 * app can fire events (e.g. on_stream_complete, on_song_publish) without
 * waiting for the implementation.
 */
import type { DiscoveryJobPayload } from '@pazzera/queue';

export interface DiscoveryDecision {
  /** What the worker ended up doing. 'noop' until implementation lands. */
  action: 'noop' | 'rebuild_user_feed' | 'rebuild_global_trending' | 'index_search';
  reason: string;
}

export function decideDiscovery(_payload: DiscoveryJobPayload): DiscoveryDecision {
  return {
    action: 'noop',
    reason: 'discovery_agent_not_implemented',
  };
}