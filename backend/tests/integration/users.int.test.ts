import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("Usuarios (/api/users) — provisión de accesos para portales externos", () => {
  let token: string;
  let carrierId: string;
  let driverId: string;

  beforeEach(async () => {
    await resetDatabase();
    const fixtures = await seedMinimalFixtures(request(app));
    token = fixtures.adminToken;

    const carrierRes = await request(app)
      .post("/api/carriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ legalName: "Transportista Test", taxId: `T-${Date.now()}` });
    carrierId = carrierRes.body.id;

    const driverRes = await request(app)
      .post("/api/vehicles/drivers")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, fullName: "Conductor Test", taxId: `D-${Date.now()}` });
    driverId = driverRes.body.id;
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("crea un usuario de Portal Transportista vinculado a su carrierId", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: "portal@test.local",
        fullName: "Usuario Portal",
        password: "Password123!",
        userType: "carrier_portal",
        carrierId,
      });

    expect(res.status).toBe(201);

    // El login con ese usuario debe devolver un token con carrierId — es lo que el
    // middleware requireCarrierPortal usa para restringir el scope.
    const login = await request(app).post("/api/auth/login").send({ email: "portal@test.local", password: "Password123!" });
    expect(login.body.user.userType).toBe("carrier_portal");
  });

  it("crea un usuario de App Conductor vinculado a carrierId y driverId, y puede ver su ruta de hoy", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: "conductor-test@test.local",
        fullName: "Conductor Test User",
        password: "Password123!",
        userType: "driver_app",
        carrierId,
        driverId,
      });
    expect(res.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({ email: "conductor-test@test.local", password: "Password123!" });
    expect(login.status).toBe(200);

    const todayRoute = await request(app).get("/api/driver-app/today-route").set("Authorization", `Bearer ${login.body.token}`);
    expect(todayRoute.status).toBe(200);
    expect(todayRoute.body.shipment).toBeNull(); // sin ruta asignada hoy, pero el endpoint responde correctamente
  });

  it("rechaza crear un usuario de Portal Transportista sin carrierId", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "sin-carrier@test.local", fullName: "Sin Carrier", password: "Password123!", userType: "carrier_portal" });

    expect(res.status).toBe(400);
  });

  it("rechaza emails duplicados con 409", async () => {
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@test.local", fullName: "Uno", password: "Password123!", userType: "carrier_portal", carrierId });

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@test.local", fullName: "Dos", password: "Password123!", userType: "carrier_portal", carrierId });

    expect(res.status).toBe(409);
  });

  it("un usuario sin rol de administrador no puede acceder a /api/users", async () => {
    // Crea un segundo usuario interno sin rol admin_empresa y comprueba que /api/users
    // le devuelve 403 (control de acceso reforzado en backend, no solo en UI).
    const plainUserRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "planificador-test@test.local", fullName: "Planificador Test", password: "Password123!", userType: "internal" });
    expect(plainUserRes.status).toBe(201);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "planificador-test@test.local", password: "Password123!" });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });

  it("permite desactivar un usuario, bloqueando su siguiente acceso funcional", async () => {
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "desactivar@test.local", fullName: "A desactivar", password: "Password123!", userType: "carrier_portal", carrierId });

    const list = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    const created_user = list.body.items.find((u: any) => u.email === "desactivar@test.local");

    const deactivate = await request(app)
      .patch(`/api/users/${created_user.id}/active`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });
    expect(deactivate.status).toBe(200);

    const login = await request(app).post("/api/auth/login").send({ email: "desactivar@test.local", password: "Password123!" });
    expect(login.status).toBe(401);
  });
});
