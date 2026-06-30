/**
 * User repository — all User reads/writes go through here.
 *
 * Keeping this out of route handlers lets us swap to a service layer later
 * without rewriting callers.
 */
import { prisma, type Prisma } from '../client';

export type UserCreateInput = {
  email: string;
  username: string;
  displayName?: string | null;
};

export const UserRepo = {
  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },
  async findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },
  async findByIdWithWallet(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: { wallet: true, artistProfile: true },
    });
  },
  async create(data: UserCreateInput) {
    return prisma.user.create({ data });
  },
  async findOrCreateByEmail(data: UserCreateInput) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return { user: existing, created: false };
    // Generate a placeholder username if not provided
    const username = data.username || `user_${data.email.split('@')[0].slice(0, 16)}_${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({
      data: { ...data, username },
    });
    return { user, created: true };
  },
  async setOnboardStatus(userId: string, status: 'pending' | 'approved' | 'rejected', opts?: { isArtist?: boolean }) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        onboardStatus: status,
        isArtist: opts?.isArtist ?? false,
        onboardedAt: status === 'approved' ? new Date() : null,
      },
    });
  },
  async setLastSeen(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  },
  async listAdmins() {
    const env = process.env.ADMIN_EMAILS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    if (env.length === 0) return [];
    return prisma.user.findMany({
      where: { email: { in: env } },
      select: { id: true, email: true, username: true },
    });
  },
  async isAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true },
    });
    if (user?.role === 'admin') return true;
    const env = process.env.ADMIN_EMAILS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return user ? env.includes(user.email) : false;
  },
};

export type { Prisma };