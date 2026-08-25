import { prisma } from '../db.js';
import { notFound } from '../http-error.js';

export async function listForwarders() {
  return prisma.forwarder.findMany({
    include: { _count: { select: { shipments: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function getForwarder(id: string) {
  const forwarder = await prisma.forwarder.findUnique({
    where: { id },
    include: { shipments: { orderBy: { createdAt: 'desc' } } },
  });
  if (!forwarder) notFound('Forwarder');
  return forwarder;
}

export async function createForwarder(data: {
  name: string;
  contact?: string;
  country?: string;
  notes?: string;
}) {
  return prisma.forwarder.create({ data });
}

export async function updateForwarder(
  id: string,
  data: {
    name?: string;
    contact?: string | null;
    country?: string | null;
    notes?: string | null;
  },
) {
  await getForwarder(id);
  return prisma.forwarder.update({ where: { id }, data });
}
