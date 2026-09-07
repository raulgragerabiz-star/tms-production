import { NextFunction, Request, Response } from "express";
import { verifyToken, JwtPayload } from "@/modules/auth/auth.service";
import { HttpError } from "@/utils/http-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(HttpError.unauthorized());
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    next(HttpError.unauthorized("Token inválido o expirado"));
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(HttpError.unauthorized());
    const hasRole = req.auth.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) return next(HttpError.forbidden());
    next();
  };
}
