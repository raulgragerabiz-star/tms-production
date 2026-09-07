import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Vacía todas las tablas de negocio entre tests, respetando FKs (orden inverso de creación).
// Se usa TRUNCATE ... CASCADE para no tener que enumerar el orden exacto de dependencias.
export async function resetDatabase() {
  const tableNames: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`
  );
  const tables = tableNames.map((t) => `"${t.tablename}"`).join(", ");
  if (tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
  }
}

interface SeededFixtures {
  companyId: string;
  warehouseId: string;
  adminToken: string;
  adminUserId: string;
}

// Siembra el mínimo imprescindible para levantar la API en un test: empresa, almacén,
// rol admin con todos los permisos, y un usuario admin ya logueado (token JWT real,
// obtenido vía /api/auth/login para probar también esa ruta end-to-end).
export async function seedMinimalFixtures(request: any): Promise<SeededFixtures> {
  const company = await prisma.company.create({
    data: { name: "Test Co", taxId: `TEST-${Date.now()}`, active: true },
  });
  const warehouse = await prisma.warehouse.create({
    data: { companyId: company.id, name: "Almacén Test", city: "Madrid", country: "ES" },
  });

  const permission = await prisma.permission.upsert({
    where: { code: "test.all" },
    update: {},
    create: { code: "test.all" },
  });
  const role = await prisma.role.create({ data: { companyId: company.id, name: "Admin Test", code: "admin_empresa" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

  const passwordHash = await bcrypt.hash("Test1234!", 10);
  const user = await prisma.appUser.create({
    data: {
      companyId: company.id,
      email: `admin-${Date.now()}@test.local`,
      passwordHash,
      fullName: "Admin Test",
      userType: "internal",
      active: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  const loginRes = await request.post("/api/auth/login").send({ email: user.email, password: "Test1234!" });

  return {
    companyId: company.id,
    warehouseId: warehouse.id,
    adminToken: loginRes.body.token,
    adminUserId: user.id,
  };
}
