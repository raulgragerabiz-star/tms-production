import {
  groupOrdersIntoZones,
  isVehicleTypeCompatibleWithSegment,
  PendingOrderForGrouping,
} from "../modules/planning/zone-grouping.service";
import { ServiceSegment } from "@prisma/client";

describe("groupOrdersIntoZones", () => {
  it("agrupa en un único clúster una provincia con volumen bajo", () => {
    const orders: PendingOrderForGrouping[] = Array.from({ length: 5 }).map((_, i) => ({
      orderId: `o${i}`,
      provinceId: "madrid",
      lat: 40.4 + i * 0.01,
      lng: -3.7,
      segment: ServiceSegment.paleteria,
      leadTimeDays: 2,
    }));

    const clusters = groupOrdersIntoZones(orders);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].orders).toHaveLength(5);
  });

  it("usa el índice de rejilla (grid) con volumen alto y agrupa igual de bien que el barrido exhaustivo", () => {
    // 12 pedidos MUY cercanos entre sí (deben quedar en el mismo clúster)
    const closeGroup: PendingOrderForGrouping[] = Array.from({ length: 12 }).map((_, i) => ({
      orderId: `close-${i}`,
      provinceId: "madrid",
      lat: 40.4 + i * 0.001, // ~100m entre pedidos consecutivos
      lng: -3.7,
      segment: ServiceSegment.paleteria,
      leadTimeDays: 2,
    }));

    // 3 pedidos muy lejos (deben quedar en un clúster distinto)
    const farGroup: PendingOrderForGrouping[] = Array.from({ length: 3 }).map((_, i) => ({
      orderId: `far-${i}`,
      provinceId: "madrid",
      lat: 40.9 + i * 0.001, // a más de 50km del grupo anterior
      lng: -3.2,
      segment: ServiceSegment.paleteria,
      leadTimeDays: 2,
    }));

    const clusters = groupOrdersIntoZones([...closeGroup, ...farGroup], 15);

    // El grupo cercano completo debe estar en un único clúster
    const clusterWithClose = clusters.find((c) =>
      c.orders.some((o) => o.orderId.startsWith("close-"))
    );
    expect(clusterWithClose?.orders).toHaveLength(12);

    // El grupo lejano nunca debe mezclarse con el cercano
    const clusterWithFar = clusters.find((c) => c.orders.some((o) => o.orderId.startsWith("far-")));
    expect(clusterWithFar?.orders.every((o) => o.orderId.startsWith("far-"))).toBe(true);
  });

  it("no pierde pedidos en los bordes de celda del grid (vecindario 3x3)", () => {
    // Dos pedidos deliberadamente cerca de un borde de celda teórico pero
    // dentro del radio real — deben seguir agrupándose gracias a la
    // búsqueda en las 8 celdas vecinas, no solo la propia.
    const orders: PendingOrderForGrouping[] = [
      ...Array.from({ length: 9 }).map((_, i) => ({
        orderId: `pad-${i}`,
        provinceId: "madrid",
        lat: 40.0 + i * 0.0005,
        lng: -3.0,
        segment: ServiceSegment.paleteria as const,
        leadTimeDays: 2,
      })),
      { orderId: "edge-a", provinceId: "madrid", lat: 40.135, lng: -3.135, segment: ServiceSegment.paleteria, leadTimeDays: 2 },
      { orderId: "edge-b", provinceId: "madrid", lat: 40.136, lng: -3.136, segment: ServiceSegment.paleteria, leadTimeDays: 2 },
    ];

    const clusters = groupOrdersIntoZones(orders, 5);
    const clusterWithEdgeA = clusters.find((c) => c.orders.some((o) => o.orderId === "edge-a"));
    expect(clusterWithEdgeA?.orders.some((o) => o.orderId === "edge-b")).toBe(true);
  });

  it("prioriza los clústeres con leadTimeDays medio más bajo", () => {
    const urgent: PendingOrderForGrouping = {
      orderId: "urgent",
      provinceId: "caceres",
      lat: 39.4,
      lng: -6.3,
      segment: ServiceSegment.paleteria,
      leadTimeDays: 0,
    };
    const normal: PendingOrderForGrouping = {
      orderId: "normal",
      provinceId: "madrid",
      lat: 40.4,
      lng: -3.7,
      segment: ServiceSegment.paleteria,
      leadTimeDays: 5,
    };

    const clusters = groupOrdersIntoZones([normal, urgent]);
    expect(clusters[0].orders[0].orderId).toBe("urgent");
  });
});

describe("isVehicleTypeCompatibleWithSegment", () => {
  it("es compatible si el segmento del pedido está en la lista del vehicleType", () => {
    expect(
      isVehicleTypeCompatibleWithSegment([ServiceSegment.paleteria, ServiceSegment.paleteria_pesada], ServiceSegment.paleteria)
    ).toBe(true);
  });

  it("no es compatible si el segmento no está en la lista", () => {
    expect(
      isVehicleTypeCompatibleWithSegment([ServiceSegment.paqueteria], ServiceSegment.gran_volumen)
    ).toBe(false);
  });

  it("degrada a compatible-con-todo si no hay lista configurada", () => {
    expect(isVehicleTypeCompatibleWithSegment([], ServiceSegment.gran_volumen)).toBe(true);
  });
});
