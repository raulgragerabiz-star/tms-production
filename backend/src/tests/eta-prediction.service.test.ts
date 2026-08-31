jest.mock("../lib/prisma", () => ({
  prisma: { routeSpeedCalibration: { findUnique: jest.fn() } },
}));

import { prisma } from "../lib/prisma";
import { getEstimatedSpeedKmh } from "../modules/intelligence/eta-prediction.service";

describe("getEstimatedSpeedKmh — degradación segura", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("usa la velocidad calibrada si hay muestra suficiente", async () => {
    (prisma.routeSpeedCalibration.findUnique as jest.Mock).mockResolvedValue({
      avgSpeedKmh: 22.5,
      sampleSize: 40,
    });

    const result = await getEstimatedSpeedKmh("c1", "carrier1", "Madrid", new Date("2026-01-15T09:00:00"));
    expect(result.source).toBe("historical_calibration");
    expect(result.speedKmh).toBe(22.5);
    expect(result.sampleSize).toBe(40);
  });

  it("degrada al valor fijo si la muestra es insuficiente (transportista/zona nuevos)", async () => {
    (prisma.routeSpeedCalibration.findUnique as jest.Mock).mockResolvedValue({
      avgSpeedKmh: 60,
      sampleSize: 2, // por debajo del mínimo de confianza
    });

    const result = await getEstimatedSpeedKmh("c1", "carrier1", "Madrid", new Date());
    expect(result.source).toBe("fallback_static");
    expect(result.speedKmh).toBe(35);
  });

  it("degrada al valor fijo si no existe ninguna calibración todavía", async () => {
    (prisma.routeSpeedCalibration.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await getEstimatedSpeedKmh("c1", "carrier1", "Cáceres", new Date());
    expect(result.source).toBe("fallback_static");
    expect(result.sampleSize).toBeNull();
  });
});
