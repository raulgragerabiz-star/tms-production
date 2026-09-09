// Control de paginación reutilizable -- antes Pedidos, Clientes y Productos
// pedían siempre la página 1 sin ningún control para avanzar, así que con
// más de 25-100 registros (p. ej. el catálogo real de 10.635 productos) solo
// se podía ver el primer bloque, sin scroll infinito ni paginación. Mismo
// patrón simple en las 3 pantallas: "Mostrando X-Y de Z", Anterior/Siguiente,
// y un selector de tamaño de página.
interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <span>
          {total === 0 ? "Sin resultados" : `Mostrando ${from}–${to} de ${total}`}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-md border border-slate-300 text-xs px-2 py-1"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size} / página
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-xs font-medium"
        >
          Anterior
        </button>
        <span className="text-xs text-slate-500">
          Página {page} de {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-xs font-medium"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
