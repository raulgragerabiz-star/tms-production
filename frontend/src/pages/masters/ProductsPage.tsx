import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Pagination from "@/components/Pagination";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth-store";
import ImportProductsModal from "@/pages/masters/ImportProductsModal";

// Fase 8R: rediseño completo de la ficha de producto sobre el formato de
// columnas REAL que usa Bigmat para su catálogo (capturas aportadas por
// Raúl) -- sustituye la pantalla anterior, que solo cubría un subconjunto
// de datos (dimensiones del palé completo, peso, ADR...) y no dejaba
// gestionar ni cargar la ficha comercial completa del producto (proveedor,
// familia, unidades por caja/palé, medidas por nivel de empaquetado,
// apilabilidad, condiciones de almacenamiento, etc.).
//
// "Código EAN" es el identificador que se usa en todo el sistema como SKU
// (líneas de pedido, ERP Claud...) -- ver comentario en Product.sku en
// schema.prisma. "CODIGO" es distinto: el código INTERNO de Bigmat, y es la
// clave que se usa para actualizar en vez de duplicar al volver a importar
// el catálogo (ver ImportProductsModal / product-master-import.service.ts).
//
// Los campos ADR, Frío, Retornable, Descripción carta de porte y los pesos
// no vienen en la plantilla comercial de Bigmat -- son específicos de este
// TMS (transporte ADR real, generación de la carta de porte, cálculo de
// peso por ruta) y se quedan como sección aparte, pendientes de rellenar a
// mano para cada producto igual que cualquier otro dato que no traiga la
// plantilla.
interface ProductRow {
  id: string;
  sku: string;
  description: string;
  internalCode: string | null;
  ean: string | null;
  supplier: string | null;
  category: string | null;
  abcClass: string | null;
  salesUnit: string | null;
  measurementUnit: string | null;
  unitsPerBox: number | null;
  unitsPerPallet: number | null;
  unitDepthCm: string | null;
  unitWidthCm: string | null;
  unitHeightCm: string | null;
  boxDepthCm: string | null;
  boxWidthCm: string | null;
  boxHeightCm: string | null;
  palletDepthCm: string | null;
  palletWidthCm: string | null;
  palletHeightCm: string | null;
  stackable: boolean | null;
  stackableLayers: number | null;
  storageConditions: string | null;
  weightUnit: string | null;
  packagingType: string | null;
  minOrderQtyB2c: number | null;
  grossWeightKg: string | null;
  fullPalletWeightKg: string | null;
  isReturnable: boolean;
  requiresCold: boolean;
  requiresAdr: boolean;
  carriageNoteDescription: string | null;
}

type ProductPatch = Partial<
  Pick<
    ProductRow,
    | "internalCode"
    | "ean"
    | "description"
    | "supplier"
    | "category"
    | "abcClass"
    | "salesUnit"
    | "measurementUnit"
    | "storageConditions"
    | "weightUnit"
    | "packagingType"
    | "carriageNoteDescription"
    | "stackable"
    | "requiresAdr"
    | "requiresCold"
    | "isReturnable"
  >
> & {
  unitsPerBox?: number;
  unitsPerPallet?: number;
  stackableLayers?: number;
  minOrderQtyB2c?: number;
  unitDepthCm?: number;
  unitWidthCm?: number;
  unitHeightCm?: number;
  boxDepthCm?: number;
  boxWidthCm?: number;
  boxHeightCm?: number;
  palletDepthCm?: number;
  palletWidthCm?: number;
  palletHeightCm?: number;
  grossWeightKg?: number;
  fullPalletWeightKg?: number;
};

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();
  const user = useAuthStore((s) => s.user);
  const canWipeCatalog = user?.roles?.some((r) => r === "admin_empresa" || r === "admin_plataforma") ?? false;

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

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string } & ProductPatch) => {
      const { id, ...rest } = payload;
      return (await api.put(`/products/${id}`, rest)).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
    onError: (err: any) => {
      showError(err?.response?.data?.message ?? "No se ha podido guardar el cambio");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const wipeMutation = useMutation({
    mutationFn: async () => (await api.post("/products/wipe-catalog")).data as { eliminados: number; desactivados: number },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccess(
        `Catálogo vaciado: ${result.eliminados} producto(s) eliminado(s)` +
          (result.desactivados > 0
            ? ` y ${result.desactivados} desactivado(s) por tener pedidos reales (su histórico no se ve afectado)`
            : "")
      );
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se ha podido vaciar el catálogo"),
  });

  function handleWipeCatalog() {
    if (
      window.confirm(
        "¿Vaciar TODO el catálogo de productos actual? Los productos sin pedidos asociados se eliminan; los que ya tengan algún pedido real se desactivan (su histórico no se ve afectado). Esta acción no se puede deshacer. A continuación podrás cargar el catálogo nuevo con \"Importar catálogo\"."
      )
    ) {
      wipeMutation.mutate();
    }
  }

  return (
    <div>
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Productos</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} artículos en catálogo</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            placeholder="Buscar por CODIGO, EAN, SKU o descripción…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-64"
          />
          <button
            onClick={() => setImportModalOpen(true)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            Importar catálogo
          </button>
          {canWipeCatalog && (
            <button
              onClick={handleWipeCatalog}
              disabled={wipeMutation.isPending}
              className="bg-white border border-red-300 hover:bg-red-50 text-red-600 text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap disabled:opacity-50"
            >
              {wipeMutation.isPending ? "Vaciando…" : "Vaciar catálogo"}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-2">
        "Código EAN" es el identificador que usa el resto del sistema (líneas de pedido, ERP). "CODIGO" es la
        referencia interna de Bigmat y es la clave que se usa al volver a importar el catálogo. La sección "Datos de
        transporte (TMS)", al final de la tabla, no viene en la plantilla comercial y queda pendiente de rellenar a
        mano para cada producto.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-3">CODIGO</th>
              <th className="text-left px-3 py-3">Código EAN</th>
              <th className="text-left px-3 py-3">Descripción</th>
              <th className="text-left px-3 py-3">Proveedor</th>
              <th className="text-left px-3 py-3">Familia</th>
              <th className="text-left px-3 py-3">Clasif.</th>
              <th className="text-left px-3 py-3">Ud. medida base</th>
              <th className="text-left px-3 py-3">Unidad de medida</th>
              <th className="text-right px-3 py-3">Uds/caja</th>
              <th className="text-right px-3 py-3">Uds/palé</th>
              <th className="text-left px-3 py-3">Medidas Unidad (F×A×A cm)</th>
              <th className="text-left px-3 py-3">Medidas Paquete/caja (F×A×A cm)</th>
              <th className="text-left px-3 py-3">Medidas Palet (F×A×A cm)</th>
              <th className="text-left px-3 py-3">Apilabilidad</th>
              <th className="text-left px-3 py-3">Condiciones de almacenamiento</th>
              <th className="text-left px-3 py-3">Medida a peso</th>
              <th className="text-left px-3 py-3">Tipo envase</th>
              <th className="text-right px-3 py-3">Pedido mín. B2C</th>
              <th className="text-left px-3 py-3 border-l-2 border-slate-200 bg-brand-50/50">Peso bruto (kg)</th>
              <th className="text-left px-3 py-3 bg-brand-50/50">Peso palé lleno (kg)</th>
              <th className="text-left px-3 py-3 bg-brand-50/50">ADR</th>
              <th className="text-left px-3 py-3 bg-brand-50/50">Frío</th>
              <th className="text-left px-3 py-3 bg-brand-50/50">Retornable</th>
              <th className="text-left px-3 py-3 bg-brand-50/50">Descripción carta de porte</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={24} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={24} className="px-4 py-10 text-center text-slate-400">
                  No hay productos en el catálogo todavía. Usa "Importar catálogo" para cargarlos.
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <ProductTableRow
                key={p.id}
                product={p}
                onSave={(patch) => updateMutation.mutate({ id: p.id, ...patch })}
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

      <ImportProductsModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
    </div>
  );
}

const textCellCls = "w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const narrowTextCellCls = "w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const numCellCls = "w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right";
const dimCellCls = "w-14 rounded-md border border-slate-300 px-1.5 py-1.5 text-xs text-right";
const wideTextCellCls = "w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

// Celda de texto genérica con guardado onBlur -- mismo patrón ya usado en
// toda la aplicación (Tipos de vehículo, Zonas, Productos...): cada campo se
// guarda solo al perder el foco, sin necesidad de un botón "Guardar" por fila.
function TextCell({
  value,
  className,
  placeholder,
  onSave,
}: {
  value: string | null;
  className: string;
  placeholder?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? "") && onSave(draft)}
      className={className}
    />
  );
}

function NumberCell({
  value,
  className,
  onSave,
}: {
  value: number | string | null;
  className: string;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  useEffect(() => setDraft(value != null ? String(value) : ""), [value]);
  return (
    <input
      type="number"
      min="0"
      step="any"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === "") return;
        const n = Number(draft);
        if (!Number.isNaN(n) && n !== Number(value ?? NaN)) onSave(n);
      }}
      className={className}
    />
  );
}

// Grupo de 3 medidas (Fondo x Ancho x Alto, cm) -- una misma columna visual
// de la plantilla real, partida en 3 campos reales en BD.
function DimsGroup({
  depth,
  width,
  height,
  onSave,
}: {
  depth: string | null;
  width: string | null;
  height: string | null;
  onSave: (patch: { depth?: number; width?: number; height?: number }) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <NumberCell value={depth} className={dimCellCls} onSave={(v) => onSave({ depth: v })} />
      <span className="text-slate-300 text-xs">×</span>
      <NumberCell value={width} className={dimCellCls} onSave={(v) => onSave({ width: v })} />
      <span className="text-slate-300 text-xs">×</span>
      <NumberCell value={height} className={dimCellCls} onSave={(v) => onSave({ height: v })} />
    </div>
  );
}

function ProductTableRow({ product, onSave }: { product: ProductRow; onSave: (patch: ProductPatch) => void }) {
  const [stackableLayers, setStackableLayers] = useState(product.stackableLayers != null ? String(product.stackableLayers) : "");
  useEffect(
    () => setStackableLayers(product.stackableLayers != null ? String(product.stackableLayers) : ""),
    [product.stackableLayers]
  );

  return (
    <tr className="hover:bg-brand-50/60 align-top">
      <td className="px-2 py-2">
        <TextCell value={product.internalCode} className={narrowTextCellCls} onSave={(v) => onSave({ internalCode: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.ean} className={narrowTextCellCls} onSave={(v) => onSave({ ean: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.description} className={wideTextCellCls} onSave={(v) => onSave({ description: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.supplier} className={textCellCls} onSave={(v) => onSave({ supplier: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.category} className={textCellCls} onSave={(v) => onSave({ category: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.abcClass} className={narrowTextCellCls} onSave={(v) => onSave({ abcClass: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.salesUnit} className={narrowTextCellCls} onSave={(v) => onSave({ salesUnit: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.measurementUnit} className={narrowTextCellCls} onSave={(v) => onSave({ measurementUnit: v })} />
      </td>
      <td className="px-2 py-2">
        <NumberCell value={product.unitsPerBox} className={numCellCls} onSave={(v) => onSave({ unitsPerBox: v })} />
      </td>
      <td className="px-2 py-2">
        <NumberCell value={product.unitsPerPallet} className={numCellCls} onSave={(v) => onSave({ unitsPerPallet: v })} />
      </td>
      <td className="px-2 py-2">
        <DimsGroup
          depth={product.unitDepthCm}
          width={product.unitWidthCm}
          height={product.unitHeightCm}
          onSave={(patch) =>
            onSave({
              ...(patch.depth != null ? { unitDepthCm: patch.depth } : {}),
              ...(patch.width != null ? { unitWidthCm: patch.width } : {}),
              ...(patch.height != null ? { unitHeightCm: patch.height } : {}),
            })
          }
        />
      </td>
      <td className="px-2 py-2">
        <DimsGroup
          depth={product.boxDepthCm}
          width={product.boxWidthCm}
          height={product.boxHeightCm}
          onSave={(patch) =>
            onSave({
              ...(patch.depth != null ? { boxDepthCm: patch.depth } : {}),
              ...(patch.width != null ? { boxWidthCm: patch.width } : {}),
              ...(patch.height != null ? { boxHeightCm: patch.height } : {}),
            })
          }
        />
      </td>
      <td className="px-2 py-2">
        <DimsGroup
          depth={product.palletDepthCm}
          width={product.palletWidthCm}
          height={product.palletHeightCm}
          onSave={(patch) =>
            onSave({
              ...(patch.depth != null ? { palletDepthCm: patch.depth } : {}),
              ...(patch.width != null ? { palletWidthCm: patch.width } : {}),
              ...(patch.height != null ? { palletHeightCm: patch.height } : {}),
            })
          }
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <select
            value={product.stackable == null ? "" : product.stackable ? "si" : "no"}
            onChange={(e) => onSave({ stackable: e.target.value === "" ? undefined : e.target.value === "si" })}
            className="rounded-md border border-slate-300 px-1.5 py-1.5 text-xs"
          >
            <option value="">—</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
          <input
            type="number"
            min="0"
            step="1"
            value={stackableLayers}
            placeholder="capas"
            onChange={(e) => setStackableLayers(e.target.value)}
            onBlur={() => {
              if (stackableLayers === "") return;
              const n = Number(stackableLayers);
              if (!Number.isNaN(n) && n !== (product.stackableLayers ?? -1)) onSave({ stackableLayers: n });
            }}
            className="w-14 rounded-md border border-slate-300 px-1.5 py-1.5 text-xs text-right"
          />
        </div>
      </td>
      <td className="px-2 py-2">
        <TextCell
          value={product.storageConditions}
          className={wideTextCellCls}
          onSave={(v) => onSave({ storageConditions: v })}
        />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.weightUnit} className={narrowTextCellCls} onSave={(v) => onSave({ weightUnit: v })} />
      </td>
      <td className="px-2 py-2">
        <TextCell value={product.packagingType} className={narrowTextCellCls} onSave={(v) => onSave({ packagingType: v })} />
      </td>
      <td className="px-2 py-2">
        <NumberCell value={product.minOrderQtyB2c} className={numCellCls} onSave={(v) => onSave({ minOrderQtyB2c: v })} />
      </td>
      <td className="px-2 py-2 border-l-2 border-slate-100 bg-brand-50/30">
        <NumberCell value={product.grossWeightKg} className={numCellCls} onSave={(v) => onSave({ grossWeightKg: v })} />
      </td>
      <td className="px-2 py-2 bg-brand-50/30">
        <NumberCell value={product.fullPalletWeightKg} className={numCellCls} onSave={(v) => onSave({ fullPalletWeightKg: v })} />
      </td>
      <td className="px-2 py-2 bg-brand-50/30">
        <input
          type="checkbox"
          checked={product.requiresAdr}
          onChange={(e) => onSave({ requiresAdr: e.target.checked })}
          className="rounded border-slate-300"
        />
      </td>
      <td className="px-2 py-2 bg-brand-50/30">
        <input
          type="checkbox"
          checked={product.requiresCold}
          onChange={(e) => onSave({ requiresCold: e.target.checked })}
          className="rounded border-slate-300"
        />
      </td>
      <td className="px-2 py-2 bg-brand-50/30">
        <input
          type="checkbox"
          checked={product.isReturnable}
          onChange={(e) => onSave({ isReturnable: e.target.checked })}
          className="rounded border-slate-300"
        />
      </td>
      <td className="px-2 py-2 bg-brand-50/30">
        <TextCell
          value={product.carriageNoteDescription}
          className={textCellCls}
          placeholder="Ej. material de construcción"
          onSave={(v) => onSave({ carriageNoteDescription: v })}
        />
      </td>
    </tr>
  );
}
