import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { AdminDashboard } from '@/components/admin/admin-dashboard';

export const metadata = { title: 'Admin — Pazzera' };

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const isAdmin = me?.role === 'admin' || (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).includes(me?.email ?? '');
  if (!isAdmin) redirect('/dashboard');
  return <AdminDashboard />;
}