import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.tenant.upsert({
    where: { slug: 'escritorio-demo' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Escritório Demo',
      slug: 'escritorio-demo',
      plan: 'CONTROL',
    },
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
