import { Router } from "express";
import { z } from "zod";
import { login } from "./auth.service";
import { asyncHandler } from "@/utils/async-handler";
import { requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const result = await login(email, password);
    res.json(result);
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.appUser.findUnique({
      where: { id: req.auth!.sub },
      include: { roles: { include: { role: true } } },
    });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      roles: user.roles.map((r) => r.role.code),
      companyId: user.companyId,
    });
  })
);
