// Encabezado de sección: etiqueta en mayúsculas + una línea horizontal que
// rellena el resto del ancho -- mismo patrón que el panel de referencia
// aportado por Raúl (TMS Getafe) para separar bloques dentro de una misma
// pantalla sin necesidad de tarjetas anidadas.
interface Props {
  children: string;
}

export default function SectionTitle({ children }: Props) {
  return (
    <div className="flex items-center gap-3 mt-8 mb-3 first:mt-0">
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
        {children}
      </span>
      <span className="flex-1 h-px bg-slate-200" />
    </div>
  );
}
