/**
 * Payment + Payout + LedgerEntry repository.
 */
import { prisma } from '../client';

export const PaymentRepo = {
  async findByStreamId(streamId: string) {
    return prisma.payment.findUnique({ where: { streamId } });
  },
  async createPending(data: {
    streamId: string;
    songId: string;
    payerUserId: string;
    amountUsdc: string;
    amountBaseUnits: string;
  }) {
    return prisma.payment.upsert({
      where: { streamId: data.streamId },
      create: { ...data, status: 'pending' },
      update: { amountUsdc: data.amountUsdc, amountBaseUnits: data.amountBaseUnits, status: 'pending' },
    });
  },
  async markSettled(paymentId: string, txHash: string, facilitatorTransferId: string) {
    return prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'settled',
        txHash,
        facilitatorTransferId,
        settledAt: new Date(),
      },
    });
  },
  async markFailed(paymentId: string, reason: string) {
    return prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'failed', meta: { failureReason: reason } as unknown as object },
    });
  },
  async listForUser(userId: string, opts: { skip?: number; take?: number }) {
    return prisma.payment.findMany({
      where: { payerUserId: userId },
      orderBy: { createdAt: 'desc' },
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
      include: {
        song: { select: { title: true, slug: true, coverUrl: true } },
      },
    });
  },
  async listPending() {
    return prisma.payment.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  },
  async listManualReview(opts: { take?: number }) {
    return prisma.manualReview.findMany({
      where: { status: 'pending' },
      orderBy: [{ fraudScore: 'desc' }, { createdAt: 'asc' }],
      take: opts.take ?? 50,
      include: {
        subject: { select: { username: true, email: true } },
        song: { select: { title: true, slug: true } },
      },
    });
  },
  async decideManualReview(reviewId: string, deciderId: string, decision: 'approved' | 'rejected' | 'refunded', reason: string) {
    return prisma.$transaction(async (tx) => {
      const review = await tx.manualReview.update({
        where: { id: reviewId },
        data: {
          status: decision,
          decidedById: deciderId,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      // If approved, transition payment to pending so split agent picks it up
      // If rejected, mark payment failed
      // If refunded, mark payment refunded
      if (decision === 'approved') {
        await tx.payment.update({
          where: { streamId: review.streamId },
          data: { status: 'pending' },
        });
      } else if (decision === 'rejected') {
        await tx.payment.update({
          where: { streamId: review.streamId },
          data: { status: 'failed' },
        });
        await tx.stream.update({
          where: { id: review.streamId },
          data: { flaggedAbuse: true },
        });
      } else {
        await tx.payment.update({
          where: { streamId: review.streamId },
          data: { status: 'refunded', refundedAt: new Date() },
        });
      }
      return review;
    });
  },
};