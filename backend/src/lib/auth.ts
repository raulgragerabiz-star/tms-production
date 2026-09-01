import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "CAMBIA_ESTO_EN_PRODUCCION_dev_only";
const JWT_EXPIRES_IN = "7d"; // (config) suficiente para no tener que reloguear durante la demo/presentación

if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] ⚠️  JWT_SECRET no está definido en el entorno — usando un valor por defecto de desarrollo. " +
      "Añade JWT_SECRET a tu .env antes de exponer el backend fuera de local/demo."
  );
}

export interface AuthTokenPayload {
  userId: string;
  companyId: string;
  userType: string;
  carrierId?: string;
  driverId?: string;
  customerId?: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
