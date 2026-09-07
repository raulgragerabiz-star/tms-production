import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "@/utils/http-error";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: "Error de validación",
      issues: err.issues,
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({
      message: err.message,
      details: err.details,
    });
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ message: "Error interno del servidor" });
}
