import { classifyServiceSegment, diasHabiles, SegmentationRuleInput } from "../modules/segmentation/segmentation.service";
import { ServiceSegment } from "@prisma/client";

const defaultRules: SegmentationRuleInput[] = [
  { segment: ServiceSegment.paqueteria, maxWeightKg: 30, maxPallets: 0, maxWeightPerPalletKg: null, maxVolumeM3: 0.5, priority: 1 },
  { segment: ServiceSegment.paleteria, maxWeightKg: 800, maxPallets: 4, maxWeightPerPalletKg: 400, maxVolumeM3: 6, priority: 2 },
  { segment: ServiceSegment.paleteria_pesada, maxWeightKg: 3000, maxPallets: 6, maxWeightPerPalletKg: 1200, maxVolumeM3: 12, priority: 3 },
  { segment: ServiceSegment.gran_volumen, maxWeightKg: null, maxPallets: null, maxWeightPerPalletKg: null, maxVolumeM3: null, priority: 4 },
];

describe("classifyServiceSegment", () => {
  it("clasifica un pedido pequeño como paqueteria", () => {
    const result = classifyServiceSegment(
      { totalWeightKg: 15, totalPallets: 0, totalVolumeM3: 0.2 },
      defaultRules
    );
    expect(result).toBe(ServiceSegment.paqueteria);
  });

  it("clasifica un pedido de 2 palés estándar como paleteria", () => {
    const result = classifyServiceSegment(
      { totalWeightKg: 500, totalPallets: 2, totalVolumeM3: 3, maxWeightPerPalletKg: 250 },
      defaultRules
    );
    expect(result).toBe(ServiceSegment.paleteria);
  });

  it("clasifica como paleteria_pesada cuando el peso por palé supera el umbral de paleteria aunque el peso total encaje", () => {
    const result = classifyServiceSegment(
      { totalWeightKg: 700, totalPallets: 2, totalVolumeM3: 4, maxWeightPerPalletKg: 900 },
      defaultRules
    );
    expect(result).toBe(ServiceSegment.paleteria_pesada);
  });

  it("hace fallback a gran_volumen cuando nada matchea", () => {
    const result = classifyServiceSegment(
      { totalWeightKg: 12000, totalPallets: 20, totalVolumeM3: 40 },
      defaultRules
    );
    expect(result).toBe(ServiceSegment.gran_volumen);
  });

  it("respeta el orden de priority, no el orden del array de entrada", () => {
    const shuffled = [defaultRules[3], defaultRules[0], defaultRules[2], defaultRules[1]];
    const result = classifyServiceSegment(
      { totalWeightKg: 15, totalPallets: 0, totalVolumeM3: 0.2 },
      shuffled
    );
    expect(result).toBe(ServiceSegment.paqueteria);
  });
});

describe("diasHabiles", () => {
  it("cuenta solo días de lunes a viernes", () => {
    // Viernes 2026-01-02 -> Lunes 2026-01-05 = 1 día hábil
    const from = new Date("2026-01-02T08:00:00Z");
    const to = new Date("2026-01-05T08:00:00Z");
    expect(diasHabiles(from, to)).toBe(1);
  });

  it("devuelve 0 si la fecha de promesa es anterior o igual a la de creación", () => {
    const d = new Date("2026-01-05T08:00:00Z");
    expect(diasHabiles(d, d)).toBe(0);
  });
});
