import { describe, expect, it } from "vitest";
import { HttpError } from "@/utils/http-error";

describe("HttpError", () => {
  it("badRequest crea un error 400", () => {
    const err = HttpError.badRequest("mensaje");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("mensaje");
  });

  it("notFound usa mensaje por defecto", () => {
    const err = HttpError.notFound();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Recurso no encontrado");
  });

  it("conflict conserva detalles", () => {
    const err = HttpError.conflict("solape", { rateId: "abc" });
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ rateId: "abc" });
  });
});
