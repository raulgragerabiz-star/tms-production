import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { processErpclaudImport } from "./erpclaud.service";

const LineaSchema = z.object({
  sku: z.string().min(1),
  descripcion: z.string().optional(),
  cantidad: z.number().positive(),
  unidad: z.string().min(1),
  pesoKg: z.number().nonnegative().optional(),
  volumenM3: z.number().nonnegative().optional(),
});

const PedidoSchema = z.object({
  externalOrderId: z.string().min(1),
  socio: z.object({
    codigo: z.string().min(1),
    nombre: z.string().min(1),
    nifCif: z.string().optional(),
  }),
  direccionEntrega: z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    province: z.string().min(1),
    postalCode: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  fechaCreacion: z.string().datetime(),
  fechaPromesa: z.string().datetime(),
  lineas: z.array(LineaSchema).min(1),
});

const ImportPayloadSchema = z.object({
  schemaVersion: z.literal("1.0"),
  pedidos: z.array(PedidoSchema).min(1),
});

export async function importOrdersFromErpclaud(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = ImportPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const companyId = req.auth!.companyId;
    const summary = await processErpclaudImport(companyId, parsed.data);

    return res.status(200).json({ summary });
  } catch (err) {
    next(err);
  }
}
