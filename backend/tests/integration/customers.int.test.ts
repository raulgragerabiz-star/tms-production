import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("Clientes (/api/customers)", () => {
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    const fixtures = await seedMinimalFixtures(request(app));
    token = fixtures.adminToken;
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it("crea un cliente con código de negocio de 6 dígitos", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "488000", legalName: "SANEAMIENTO LINARES, S.L." });

    expect(res.status).toBe(201);
    expect(res.body.businessCode).toBe("488000");
  });

  it("rechaza un código de negocio duplicado para la misma empresa con 409", async () => {
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "488000", legalName: "Cliente A" });

    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "488000", legalName: "Cliente B (duplicado)" });

    expect(res.status).toBe(409);
  });

  it("lista clientes filtrando por texto de búsqueda", async () => {
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "100001", legalName: "Ferretería Norte" });
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "100002", legalName: "Materiales Sur" });

    const res = await request(app).get("/api/customers").query({ search: "Norte" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].legalName).toBe("Ferretería Norte");
  });

  it("el borrado es lógico (soft delete): el cliente deja de listarse pero no se destruye", async () => {
    const created = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "200001", legalName: "Cliente a borrar" });

    const del = await request(app).delete(`/api/customers/${created.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/customers").set("Authorization", `Bearer ${token}`);
    expect(list.body.items.find((c: any) => c.id === created.body.id)).toBeUndefined();
  });

  it("devuelve 404 al consultar un cliente inexistente", async () => {
    const res = await request(app)
      .get("/api/customers/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
