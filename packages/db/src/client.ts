/**
 * Singleton Prisma client.
 *
 * Avoids creating multiple connection pools during Next.js dev hot reload.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '@pazzera/core';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Wire query logs through pino
prisma.$on('query' as never, (e: { query: string; duration: number }) => {
  logger.debug({ query: e.query, durationMs: e.duration }, 'prisma:query');
});
prisma.$on('error' as never, (e: { message: string }) => {
  logger.error({ msg: e.message }, 'prisma:error');
});

export type Prisma = typeof prisma;