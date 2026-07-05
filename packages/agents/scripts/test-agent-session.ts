/**
 * Test the AgentUploadSession Prisma model end-to-end.
 * Mirrors what the route does: create, update, append message.
 */
import { prisma } from '@pazzera/db';

async function main() {
  // 1. Create a session (mimics POST /api/agent/upload/message with no sessionId)
  const row = await prisma.agentUploadSession.create({
    data: {
      userId: 'cmr284v8l000b9fz0fg52zdk5',
      state: { state: 'idle', draft: {} } as object,
      messages: [
        { id: 'msg_x', role: 'assistant', kind: 'greeting', text: 'test', createdAt: new Date().toISOString() },
      ] as object,
    },
  });
  console.log('created:', row.id, 'updatedAt:', row.updatedAt.toISOString());

  // 2. Update state (mimics appendMessage + updateSessionState)
  await prisma.agentUploadSession.update({
    where: { id: row.id },
    data: {
      state: { state: 'awaiting_audio', draft: { audioFileName: 'test.mp3' } } as object,
      messages: {
        array_append: { 'messages': [{ id: 'msg_y', role: 'assistant', kind: 'chat', text: 'hi', createdAt: new Date().toISOString() }] } as any,
      },
    },
  });
  // ^ Prisma's append message uses raw SQL in the actual code, just smoke-test update here
  const reFetched = await prisma.agentUploadSession.findUnique({ where: { id: row.id } });
  console.log('after update: state.state =', (reFetched?.state as { state: string })?.state, 'updatedAt:', reFetched?.updatedAt.toISOString());

  // 3. Clean up
  await prisma.agentUploadSession.delete({ where: { id: row.id } });
  console.log('cleaned up');
}

main()
  .catch((e) => {
    console.error('failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });