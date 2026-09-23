// Gestión de usuarios internos y de portales externos (Fase 2 §7). Imprescindible para
// poder dar de alta transportistas/conductores reales sin tocar el seed — es el último
// eslabón para que la empresa pueda operar el sistema de forma autónoma.
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const usersRouter = Router();

// Fase 26 ("usuarios app" sub-fase 4): "carrier_portal" se retira de los tipos
// de acceso que se pueden CREAR -- el Portal Transportista (apps/carrier-portal)
// se retiró por completo (petición explícita de Raúl, ver
// claude/fase26-retirada-portal-transportista.md). El valor sigue existiendo en
// el enum UserType de la base de datos (no se toca, mismo criterio que otras
// fases de este proyecto): cualquier cuenta AppUser antigua con este tipo se
// deja intacta para histórico, solo deja de poderse crear una nueva.
const userSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  userType: z.enum(["internal", "customer_portal", "driver_app"]),
  roleIds: z.array(z.string().uuid()).optional(),
  carrierId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  // Fase 23: "usuarios app" -- centro (Warehouse) al que pertenece el
  // usuario. Ver validación de obligatoriedad más abajo (POST /): el rol
  // Planificador siempre debe traerlo; el rol Administrador puede omitirlo
  // (sin centro = ve/administra todos, ver warehouse-scope.ts).
  warehouseId: z.string().uuid().optional(),
});

async function assertScopedRefsBelongToCompany(
  companyId: string,
  refs: { carrierId?: string; customerId?: string; driverId?: string; warehouseId?: string }
) {
  if (refs.carrierId) {
    const carrier = await prisma.carrier.findFirst({ where: { id: refs.carrierId, companyId } });
    if (!carrier) throw HttpError.badRequest("El transportista indicado no existe en esta empresa");
  }
  if (refs.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: refs.customerId, companyId } });
    if (!customer) throw HttpError.badRequest("El cliente indicado no existe en esta empresa");
  }
  if (refs.driverId) {
    const driver = await prisma.driver.findFirst({ where: { id: refs.driverId, carrier: { companyId } } });
    if (!driver) throw HttpError.badRequest("El conductor indicado no existe en esta empresa");
  }
  if (refs.warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: refs.warehouseId, companyId } });
    if (!warehouse) throw HttpError.badRequest("El centro (almacén) indicado no existe en esta empresa");
  }
}

// Fase 23: con los roles reducidos a Administrador ("admin_empresa") y
// Planificador ("planificador"), cada usuario interno tiene exactamente UNO
// de los dos -- "pudiendo crearse en cada uno varios perfiles" (petición de
// Raúl) significa varias CUENTAS, cada una con su propio rol y centro, no
// una cuenta con varios roles a la vez. Devuelve el código del rol elegido
// para poder exigir o no el centro según cuál sea.
async function resolveSingleInternalRoleCode(companyId: string, roleIds: string[] | undefined): Promise<string> {
  if (!roleIds || roleIds.length !== 1) {
    throw HttpError.badRequest("Un usuario interno debe tener exactamente un rol: Administrador o Planificador");
  }
  const role = await prisma.role.findFirst({
    where: { id: roleIds[0], OR: [{ companyId }, { companyId: null }] },
  });
  if (!role || (role.code !== "admin_empresa" && role.code !== "planificador")) {
    throw HttpError.badRequest("Rol no válido. Los roles disponibles son Administrador y Planificador");
  }
  return role.code;
}

usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userType = req.query.userType as string | undefined;
    const items = await prisma.appUser.findMany({
      where: { companyId: req.auth!.companyId, ...(userType ? { userType: userType as any } : {}) },
      select: {
        id: true,
        email: true,
        fullName: true,
        userType: true,
        carrierId: true,
        customerId: true,
        driverId: true,
        warehouseId: true,
        active: true,
        createdAt: true,
        roles: { include: { role: { select: { id: true, name: true, code: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    // Fase 23: se resuelve aquí el nombre del centro (en vez de un `include`
    // de relación en la consulta de arriba) porque warehouseId es una
    // referencia suelta sin @relation formal en el modelo, mismo criterio ya
    // usado para carrierId/customerId/driverId en este fichero.
    const warehouseIds = Array.from(
      new Set(items.map((u: { warehouseId: string | null }) => u.warehouseId).filter((id: string | null): id is string => !!id))
    );
    const warehouses = warehouseIds.length
      ? await prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } })
      : [];
    const warehouseNameById = new Map(warehouses.map((w: { id: string; name: string }) => [w.id, w.name]));
    const itemsWithWarehouse = items.map((u: { warehouseId: string | null }) => ({
      ...u,
      warehouseName: u.warehouseId ? warehouseNameById.get(u.warehouseId) ?? null : null,
    }));
    res.json({ items: itemsWithWarehouse, total: itemsWithWarehouse.length });
  })
);

usersRouter.get(
  "/roles",
  asyncHandler(async (req, res) => {
    const items = await prisma.role.findMany({
      where: { OR: [{ companyId: req.auth!.companyId }, { companyId: null }] },
      orderBy: { name: "asc" },
    });
    res.json({ items, total: items.length });
  })
);

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = userSchema.parse(req.body);
    const companyId = req.auth!.companyId;

    // Consistencia de scope: cada tipo de usuario externo debe traer su referencia,
    // y no debe traer las de otros tipos (evita usuarios "ambiguos" con carrierId Y
    // customerId a la vez, por ejemplo).
    if (data.userType === "customer_portal" && !data.customerId) {
      throw HttpError.badRequest("Un usuario de Portal Cliente requiere customerId");
    }
    if (data.userType === "driver_app" && (!data.carrierId || !data.driverId)) {
      throw HttpError.badRequest("Un usuario de App Conductor requiere carrierId y driverId");
    }

    // Fase 23: "usuarios app" -- solo los usuarios internos (Administrador /
    // Planificador) llevan centro. Planificador SIEMPRE debe traer uno
    // (petición explícita de Raúl); Administrador puede omitirlo (= todos
    // los centros, ver warehouse-scope.ts).
    let roleCode: string | null = null;
    if (data.userType === "internal") {
      roleCode = await resolveSingleInternalRoleCode(companyId, data.roleIds);
      if (roleCode === "planificador" && !data.warehouseId) {
        throw HttpError.badRequest("Un usuario Planificador requiere seleccionar el centro al que pertenece");
      }
    }

    await assertScopedRefsBelongToCompany(companyId, data);

    const existing = await prisma.appUser.findUnique({ where: { email: data.email } });
    if (existing) throw HttpError.conflict("Ya existe un usuario con ese email");

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.appUser.create({
      data: {
        companyId,
        email: data.email,
        fullName: data.fullName,
        passwordHash,
        userType: data.userType,
        carrierId: data.userType === "driver_app" ? data.carrierId : undefined,
        customerId: data.userType === "customer_portal" ? data.customerId : undefined,
        driverId: data.userType === "driver_app" ? data.driverId : undefined,
        warehouseId: data.userType === "internal" ? data.warehouseId : undefined,
        active: true,
      },
    });

    if (data.roleIds && data.roleIds.length > 0) {
      await prisma.userRole.createMany({
        data: data.roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }

    res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName, userType: user.userType });
  })
);

// Fase 7b: faltaba poder corregir el nombre/email de un usuario, o sus roles,
// sin tener que darlo de baja y crear uno nuevo. Deliberadamente NO se toca
// aquí userType/carrierId/customerId/driverId (el "scope" del usuario) ni la
// contraseña -- esos ya tienen su propio criterio (crear de nuevo / "Restablecer
// contraseña") y tocarlos aquí podría dejar un usuario de portal externo
// apuntando a un transportista/cliente/conductor distinto sin querer.
const userEditSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  // Fase 23: a diferencia de carrierId/customerId/driverId (identidad del
  // usuario de portal, no editable aquí -- ver comentario de cabecera), el
  // centro de un usuario interno es una asignación operativa que sí puede
  // corregirse sin dar de baja la cuenta. `null` explícito = "quitar el
  // centro" (solo válido si el rol resultante es Administrador).
  warehouseId: z.string().uuid().nullable().optional(),
});

usersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = userEditSchema.parse(req.body);
    const user = await prisma.appUser.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!user) throw HttpError.notFound("Usuario no encontrado");

    if (data.email && data.email !== user.email) {
      const existing = await prisma.appUser.findUnique({ where: { email: data.email } });
      if (existing) throw HttpError.conflict("Ya existe un usuario con ese email");
    }

    // Fase 23: si se toca el rol y/o el centro de un usuario interno, se
    // revalida la misma regla que en el alta (un único rol, Planificador
    // exige centro) contra el resultado final -- no solo contra lo que venga
    // en este PUT, por si solo se cambia uno de los dos campos.
    if (user.userType === "internal" && (data.roleIds !== undefined || data.warehouseId !== undefined)) {
      const currentRoleIds = data.roleIds ?? (
        await prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } })
      ).map((r: { roleId: string }) => r.roleId);
      const roleCode = await resolveSingleInternalRoleCode(req.auth!.companyId, currentRoleIds);
      const finalWarehouseId = data.warehouseId !== undefined ? data.warehouseId : user.warehouseId;
      if (roleCode === "planificador" && !finalWarehouseId) {
        throw HttpError.badRequest("Un usuario Planificador requiere seleccionar el centro al que pertenece");
      }
      if (finalWarehouseId) {
        await assertScopedRefsBelongToCompany(req.auth!.companyId, { warehouseId: finalWarehouseId });
      }
    }

    const updated = await prisma.appUser.update({
      where: { id: user.id },
      data: {
        email: data.email,
        fullName: data.fullName,
        ...(data.warehouseId !== undefined ? { warehouseId: data.warehouseId } : {}),
      },
    });

    if (data.roleIds) {
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      if (data.roleIds.length > 0) {
        await prisma.userRole.createMany({
          data: data.roleIds.map((roleId) => ({ userId: user.id, roleId })),
          skipDuplicates: true,
        });
      }
    }

    res.json({ id: updated.id, email: updated.email, fullName: updated.fullName, warehouseId: updated.warehouseId });
  })
);

usersRouter.patch(
  "/:id/active",
  asyncHandler(async (req, res) => {
    const schema = z.object({ active: z.boolean() });
    const { active } = schema.parse(req.body);

    const user = await prisma.appUser.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!user) throw HttpError.notFound("Usuario no encontrado");

    const updated = await prisma.appUser.update({ where: { id: user.id }, data: { active } });
    res.json({ id: updated.id, active: updated.active });
  })
);

// Fase 8i: hasta ahora solo se podía "Desactivar" (active=false, el usuario
// sigue existiendo y se puede "Reactivar") -- petición explícita de Raúl de
// poder ELIMINAR usuarios de verdad, no solo desactivarlos. A diferencia de
// Clientes/Transportistas/Almacenes (que son bajas lógicas porque tienen
// pedidos/facturación/historial colgando), un usuario es solo una credencial
// de acceso -- no hay ninguna relación real con FK hacia AppUser salvo
// UserRole, así que aquí sí se hace un borrado físico de verdad.
usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.appUser.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!user) throw HttpError.notFound("Usuario no encontrado");

    // No permitir borrar la propia cuenta desde aquí -- se quedaría sin
    // sesión válida a mitad de gestionar usuarios. Para eso, que lo borre
    // otro administrador.
    if (user.id === req.auth!.sub) {
      throw HttpError.badRequest("No puedes eliminar tu propio usuario -- pide a otro administrador que lo haga");
    }

    // UserRole sí tiene una FK real hacia AppUser (a diferencia de
    // AuditLog.userId, que es un String suelto sin relación y por tanto no
    // bloquea el borrado, aunque el registro histórico quede con un id que
    // ya no existe) -- hay que quitarla antes o el DELETE de abajo fallaría
    // por violación de integridad referencial.
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.appUser.delete({ where: { id: user.id } });
    res.status(204).send();
  })
);

usersRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const schema = z.object({ password: z.string().min(8) });
    const { password } = schema.parse(req.body);

    const user = await prisma.appUser.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!user) throw HttpError.notFound("Usuario no encontrado");

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.appUser.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  })
);
