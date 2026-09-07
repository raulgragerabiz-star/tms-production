import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { HttpError } from "@/utils/http-error";

export interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  userType: string;
  roles: string[];
  carrierId?: string | null;
  customerId?: string | null;
  driverId?: string | null;
}

export async function login(email: string, password: string) {
  const user = await prisma.appUser.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !user.active) {
    throw HttpError.unauthorized("Credenciales inválidas");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw HttpError.unauthorized("Credenciales inválidas");
  }

  const roles = user.roles.map((r) => r.role.code);

  const payload: JwtPayload = {
    sub: user.id,
    companyId: user.companyId,
    email: user.email,
    userType: user.userType,
    roles,
    carrierId: user.carrierId,
    customerId: user.customerId,
    driverId: user.driverId,
  };

  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      roles,
      companyId: user.companyId,
      carrierId: user.carrierId,
      driverId: user.driverId,
    },
  };
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
