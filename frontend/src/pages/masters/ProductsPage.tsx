import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Pagination from "@/components/Pagination";

interface ProductRow {
  id: string;
  sku: string;
  description: string;
  unitsPerPallet: number;
  grossWeightKg: string;
  fullPalletWeightKg: string;
  isReturnable: boolean;
  requiresCold: boolean;
  // Objetivo 2: dimensiones del palé completo, para calcular volumen real
  // ocupado por ruta frente a la capacidad del vehículo.
  lengthM: string | null;
  widthM: string | null;
  heightM: string | null;
  // Referencias del catálogo real (importación SURTIDO): nomenclatura,
  // rotación y código de barras -- solo informativos.
  category: string | null;
  abcClass: string | null;
  ean: string | null;
}

const abcColors: Record<string, string> = {
  "A+": "bg-emerald-100 text-emerald-700",
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-slate-200 text-slate-500",
};

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  // Paginación: con el catálogo real (10.635 productos) esta pantalla
  // siempre pedía la página 1 sin ningún control para avanzar, así que solo
  // se podían ver los primeros 25. El tamaño de página por defecto aquí es
  // mayor (100) porque es una tabla densa que se suele recorrer entera.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const { data, isLoading } = useQuery({
    queryKey: ["products", search, page, pageSize],
    queryFn: async () =>
      (await api.get("/products", { params: { search, page, pageSize } })).data as {
        items: ProductRow[];
        total: number;
      },
  });

  const updateDimensionsMutation = useMutation({
    mutationFn: async (payload: { id: string; lengthM?: number; widthM?: number; heightM?: number }) => {
      const { id, ...rest } = payload;
      return (await api.put(`/products/${id}`, rest)).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
    onError: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Productos</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} artículos en catálogo</p>
        </div>
        <input
          placeholder="Buscar por SKU o descripción…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-64"
        />
      </div>

      <p className="text-xs text-slate-400 mb-2">
        Largo/ancho/alto del palé completo — se usan para calcular el volumen real ocupado en cada ruta. Deja en
        blanco lo que no conozcas todavía; sin los 3 datos, ese producto no cuenta en el cálculo de volumen.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Descripción</th>
              <th className="text-left px-4 py-3">Categoría</th>
              <th className="text-left px-4 py-3">Rotación</th>
              <th className="text-left px-4 py-3">Uds/palé</th>
              <th className="text-left px-4 py-3">Peso bruto (kg)</th>
              <th className="text-left px-4 py-3">Peso palé lleno (kg)</th>
              <th className="text-left px-4 py-3">Retornable</th>
              <th className="text-left px-4 py-3">Frío</th>
              <th className="text-left px-4 py-3">Largo palé (m)</th>
              <th className="text-left px-4 py-3">Ancho palé (m)</th>
              <th className="text-left px-4 py-3">Alto palé (m)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((p) => (
              <ProductTableRow
                key={p.id}
                product={p}
                onSave={(patch) => updateDimensionsMutation.mutate({ id: p.id, ...patch })}
              />
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}

const dimCellCls = "w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

// Mismo patrón onBlur-save que ya usamos en Tipos de vehículo y Zonas de
// influencia: cada celda se guarda sola al perder el foco.
function ProductTableRow({
  product,
  onSave,
}: {
  product: ProductRow;
  onSave: (patch: { lengthM?: number; widthM?: number; heightM?: number }) => void;
}) {
  const [lengthM, setLengthM] = useState(product.lengthM ?? "");
  const [widthM, setWidthM] = useState(product.widthM ?? "");
  const [heightM, setHeightM] = useState(product.heightM ?? "");

  useEffect(() => setLengthM(product.lengthM ?? ""), [product.lengthM]);
  useEffect(() => setWidthM(product.widthM ?? ""), [product.widthM]);
  useEffect(() => setHeightM(product.heightM ?? ""), [product.heightM]);

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-mono text-xs">{product.sku}</td>
      <td className="px-4 py-3">{product.description}</td>
      <td className="px-4 py-3 text-slate-500 text-xs max-w-[220px] truncate" title={product.category ?? undefined}>
        {product.category?.split("\\").pop()?.trim() ?? "—"}
      </td>
      <td className="px-4 py-3">
        {product.abcClass ? (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${abcColors[product.abcClass] ?? "bg-slate-100 text-slate-600"}`}>
            {product.abcClass}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3">{product.unitsPerPallet}</td>
      <td className="px-4 py-3">{Number(product.grossWeightKg).toFixed(2)}</td>
      <td className="px-4 py-3">{Number(product.fullPalletWeightKg).toFixed(1)}</td>
      <td className="px-4 py-3">{product.isReturnable ? "Sí" : "No"}</td>
      <td className="px-4 py-3">{product.requiresCold ? "Sí" : "No"}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={lengthM}
          onChange={(e) => setLengthM(e.target.value)}
          onBlur={() =>
            lengthM !== "" && Number(lengthM) !== Number(product.lengthM ?? 0) && onSave({ lengthM: Number(lengthM) })
          }
          className={dimCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={widthM}
          onChange={(e) => setWidthM(e.target.value)}
          onBlur={() =>
            widthM !== "" && Number(widthM) !== Number(product.widthM ?? 0) && onSave({ widthM: Number(widthM) })
          }
          className={dimCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={heightM}
          onChange={(e) => setHeightM(e.target.value)}
          onBlur={() =>
            heightM !== "" && Number(heightM) !== Number(product.heightM ?? 0) && onSave({ heightM: Number(heightM) })
          }
          className={dimCellCls}
        />
      </td>
    </tr>
  );
}
