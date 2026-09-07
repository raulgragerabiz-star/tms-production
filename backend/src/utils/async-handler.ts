import { NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// express-async-errors ya captura rechazos, pero mantenemos el wrapper
// explícito por claridad y para poder tipar mejor los controladores.
export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res, next).catch(next);
