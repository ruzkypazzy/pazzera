/**
 * Realtime package — Socket.IO server + event schemas.
 *
 * Runs as a separate Node process (port 3001) so it can be deployed
 * independently of the Next.js web tier.
 */
export * from './events';
export * from './server';
export * from './session';