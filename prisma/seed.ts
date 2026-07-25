import { PrismaClient } from '@prisma/client';
import { ScryptPasswordHasher } from '../src/modules/access/infra/security/scrypt-password-hasher.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;

  if (!ownerEmail || !ownerPassword) {
    throw new Error('SEED_OWNER_EMAIL e SEED_OWNER_PASSWORD são obrigatórios para executar o seed.');
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'escritorio-demo' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Escritório Demo',
      slug: 'escritorio-demo',
      plan: 'CONTROL',
    },
  });

  const passwordHash = await new ScryptPasswordHasher().hash(ownerPassword);
  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      name: 'Administrador Demo',
      passwordHash,
      status: 'ACTIVE',
    },
    create: {
      name: 'Administrador Demo',
      email: ownerEmail,
      passwordHash,
    },
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {
      role: 'OWNER',
      status: 'ACTIVE',
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: 'OWNER',
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
