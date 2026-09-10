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

const userSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  userType: z.enum(["internal", "customer_portal", "carrier_portal", "driver_app"]),
  roleIds: z.array(z.string().uuid()).optional(),
  carrierId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});

async function assertScopedRefsBelongToCompany(
  companyId: string,
  refs: { carrierId?: string; customerId?: string; driverId?: string }
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
        active: true,
        createdAt: true,
        roles: { include: { role: { select: { id: true, name: true, code: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items, total: items.length });
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
    if (data.userType === "carrier_portal" && !data.carrierId) {
      throw HttpError.badRequest("Un usuario de Portal Transportista requiere carrierId");
    }
    if (data.userType === "customer_portal" && !data.customerId) {
      throw HttpError.badRequest("Un usuario de Portal Cliente requiere customerId");
    }
    if (data.userType === "driver_app" && (!data.carrierId || !data.driverId)) {
      throw HttpError.badRequest("Un usuario de App Conductor requiere carrierId y driverId");
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
        carrierId: data.userType === "carrier_portal" || data.userType === "driver_app" ? data.carrierId : undefined,
        customerId: data.userType === "customer_portal" ? data.customerId : undefined,
        driverId: data.userType === "driver_app" ? data.driverId : undefined,
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

    const updated = await prisma.appUser.update({
      where: { id: user.id },
      data: { email: data.email, fullName: data.fullName },
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

    res.json({ id: updated.id, email: updated.email, fullName: updated.fullName });
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
