import { prisma } from '../db.js';

export async function listFollowUps(sessionId: string) {
  return prisma.chatFollowUp.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function setFollowUp(sessionId: string, chatId: string, follow: boolean) {
  const sid = sessionId.trim();
  const cid = chatId.trim();
  if (!sid || !cid) return { sessionId: sid, chatId: cid, following: false };

  if (!follow) {
    await prisma.chatFollowUp.deleteMany({ where: { sessionId: sid, chatId: cid } });
    return { sessionId: sid, chatId: cid, following: false };
  }

  await prisma.chatFollowUp.upsert({
    where: { sessionId_chatId: { sessionId: sid, chatId: cid } },
    create: { sessionId: sid, chatId: cid },
    update: {},
  });
  return { sessionId: sid, chatId: cid, following: true };
}
