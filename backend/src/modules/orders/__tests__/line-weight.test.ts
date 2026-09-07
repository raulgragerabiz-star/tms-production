import { describe, expect, it } from "vitest";
import { computeLineWeightKg } from "../lib/line-weight";

const product = { grossWeightKg: 25, fullPalletWeightKg: 1220 };

describe("computeLineWeightKg", () => {
  it("multiplica por peso bruto unitario cuando la unidad es UD", () => {
    expect(computeLineWeightKg("UD", 10, product)).toBe(250);
  });

  it("usa el peso de palé lleno cuando la unidad es PAL", () => {
    expect(computeLineWeightKg("PAL", 2, product)).toBe(2440);
  });

  it("es insensible a mayúsculas/minúsculas en la unidad", () => {
    expect(computeLineWeightKg("pal", 1, product)).toBe(1220);
  });

  it("devuelve 0 si la cantidad es 0", () => {
    expect(computeLineWeightKg("UD", 0, product)).toBe(0);
  });
});
