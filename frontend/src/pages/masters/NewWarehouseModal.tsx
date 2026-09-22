import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: este modal servía solo para dar de alta -- se extiende para
// editar también, pasándole `warehouse` (el backend ya tenía PUT /:id desde
// antes). Sin ese prop se comporta exactamente igual que hasta ahora.
export interface WarehouseEditable {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  externalCode: string | null;
  // Fase 8k: jornada laboral máxima (horas) admitida para una ruta que sale
  // de este almacén -- ver comentario en el modelo Warehouse (schema.prisma).
  maxRouteDurationHours: number | null;
  // Fase 24 ("usuarios app" sub-fase 2): datos fiscales del emisor de los
  // documentos legales (albarán/DeCA) que salen de este centro -- antes
  // vivían en "TMS Configuración" (Company), ahora son por almacén.
  fiscalName?: string | null;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  mercantileRegistryText?: string | null;
}

interface Props {
  open: boolean;
  warehouse?: WarehouseEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewWarehouseModal({ open, warehouse, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!warehouse;
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [maxRouteDurationHours, setMaxRouteDurationHours] = useState("");
  // Fase 24: datos fiscales del emisor de documentos (albarán/DeCA) -- ver
  // comentario en WarehouseEditable arriba.
  const [fiscalName, setFiscalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [fiscalPhone, setFiscalPhone] = useState("");
  const [fiscalEmail, setFiscalEmail] = useState("");
  const [mercantileRegistryText, setMercantileRegistryText] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(warehouse?.name ?? "");
    setAddress(warehouse?.address ?? "");
    setCity(warehouse?.city ?? "");
    setProvince(warehouse?.province ?? "");
    setPostalCode(warehouse?.postalCode ?? "");
    setLat(warehouse?.lat != null ? String(warehouse.lat) : "");
    setLng(warehouse?.lng != null ? String(warehouse.lng) : "");
    setExternalCode(warehouse?.externalCode ?? "");
    setMaxRouteDurationHours(warehouse?.maxRouteDurationHours != null ? String(warehouse.maxRouteDurationHours) : "");
    setFiscalName(warehouse?.fiscalName ?? "");
    setTaxId(warehouse?.taxId ?? "");
    setFiscalPhone(warehouse?.phone ?? "");
    setFiscalEmail(warehouse?.email ?? "");
    setMercantileRegistryText(warehouse?.mercantileRegistryText ?? "");
  }, [open, warehouse]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        address: address || undefined,
        city: city || undefined,
        province: province || undefined,
        postalCode: postalCode || undefined,
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        externalCode: externalCode || undefined,
        maxRouteDurationHours: maxRouteDurationHours ? Number(maxRouteDurationHours) : undefined,
        fiscalName: fiscalName || undefined,
        taxId: taxId || undefined,
        phone: fiscalPhone || undefined,
        email: fiscalEmail || "",
        mercantileRegistryText: mercantileRegistryText || undefined,
      };
      if (isEdit) return (await api.put(`/warehouses/${warehouse!.id}`, payload)).data;
      return (await api.post("/warehouses", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      onSuccess(isEdit ? "Almacén actualizado correctamente" : "Almacén creado correctamente");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? (isEdit ? "Error al actualizar el almacén" : "Error al crear el almacén")),
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Modal open={open} title={isEdit ? `Editar almacén — ${warehouse!.name}` : "Nuevo almacén"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Nombre" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Dirección">
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Ciudad">
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Provincia">
            <input className={inputCls} value={province} onChange={(e) => setProvince(e.target.value)} />
          </Field>
          <Field label="CP">
            <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitud" hint="Para mostrarlo en el mapa del Planificador">
            <input type="number" step="any" className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitud">
            <input type="number" step="any" className={inputCls} value={lng} onChange={(e) => setLng(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Código externo"
          hint="Opcional — identificador para enlazar este almacén con otro sistema (p. ej. un proyecto de layout de almacén)"
        >
          <input className={inputCls} value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
        </Field>
        <Field
          label="Jornada laboral máxima (horas)"
          hint="Opcional — por tacógrafo/jornada, una ruta que salga de este almacén no se podrá confirmar si su duración estimada la supera. Si también hay un límite en el transportista, se aplica el más restrictivo de los dos."
        >
          <input
            type="number"
            step="0.5"
            min="0"
            max="24"
            className={inputCls}
            value={maxRouteDurationHours}
            onChange={(e) => setMaxRouteDurationHours(e.target.value)}
            placeholder="Sin límite propio"
          />
        </Field>

        {/* Fase 24 ("usuarios app" sub-fase 2): datos del EMISOR que se
            imprimen en la cabecera/pie del albarán de entrega y del DeCA
            generados desde este centro -- antes vivían en "TMS
            Configuración" (una única empresa para todo el TMS), ahora son
            por almacén, para poder tener centros que facturan como
            sociedades distintas. Sin rellenar, el documento cae en el
            propio nombre del almacén como razón social y omite el resto de
            líneas, igual que antes con los datos de empresa sin rellenar. */}
        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-700 mb-1">Datos fiscales (documentos)</p>
          <p className="text-xs text-slate-500 mb-3">
            Se imprimen en la cabecera y el pie del albarán de entrega y del DeCA que se generan desde este centro. Sin
            rellenar, el documento usa el nombre del almacén como razón social y omite el resto de líneas.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="Razón social" hint="Si se deja vacío, se usa el nombre del almacén">
              <input className={inputCls} value={fiscalName} onChange={(e) => setFiscalName(e.target.value)} placeholder={name || "BIGMAT IBERIA S.A."} />
            </Field>
            <Field label="CIF">
              <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="A81759813" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="Teléfono">
              <input className={inputCls} value={fiscalPhone} onChange={(e) => setFiscalPhone(e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" className={inputCls} value={fiscalEmail} onChange={(e) => setFiscalEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="Registro Mercantil (pie de página)">
            <input
              className={inputCls}
              value={mercantileRegistryText}
              onChange={(e) => setMercantileRegistryText(e.target.value)}
              placeholder="Inscrita en el Registro Mercantil de Madrid al Tomo: 25614, Folio: 165, Hoja: M-461575"
            />
          </Field>
          <p className="text-xs text-slate-400 mt-2">
            La dirección/CP/población/provincia de la cabecera fiscal son las mismas que la dirección del almacén, arriba.
          </p>
        </div>

        {isEdit && <WarehouseRoutesEditor warehouseId={warehouse!.id} onError={onError} />}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear almacén"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Fase 15 (más tarde): petición explícita de Raúl -- "en la parte almacenes,
// la creacion y edicion deberia permitir asignarle las rutas que le
// corresponde, de un listado que haya creado o añadir una nueva ruta en
// caso de que no exista". `DeliveryZone.warehouseId` ya existía en el
// schema desde la Fase 8 (opcional) pero no había ninguna pantalla desde la
// que gestionarlo con este almacén como punto de partida -- solo se podía
// tocar indirectamente al crear/editar el propio circuito. Solo al editar
// (hace falta el id del almacén ya guardado).
interface ZoneOption {
  id: string;
  name: string;
  warehouse: { id: string; name: string } | null;
}

function WarehouseRoutesEditor({ warehouseId, onError }: { warehouseId: string; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [newZoneName, setNewZoneName] = useState("");

  const zonesQuery = useQuery({
    queryKey: ["delivery-zones"],
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: ZoneOption[] },
  });
  const zones = zonesQuery.data?.items ?? [];
  const assigned = zones.filter((z) => z.warehouse?.id === warehouseId);
  const others = zones.filter((z) => z.warehouse?.id !== warehouseId);
  const [otherZoneId, setOtherZoneId] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["delivery-zones"] });

  const assignMutation = useMutation({
    mutationFn: async (zoneId: string) => api.patch(`/delivery-zones/${zoneId}`, { warehouseId }),
    onSuccess: () => {
      invalidate();
      setOtherZoneId("");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo asignar la ruta a este almacén"),
  });
  const unassignMutation = useMutation({
    mutationFn: async (zoneId: string) => api.patch(`/delivery-zones/${zoneId}`, { warehouseId: null }),
    onSuccess: invalidate,
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo quitar la ruta de este almacén"),
  });
  const createMutation = useMutation({
    mutationFn: async (name: string) => api.post("/delivery-zones", { name, warehouseId }),
    onSuccess: () => {
      invalidate();
      setNewZoneName("");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo crear la ruta"),
  });

  return (
    <div className="border-t border-slate-200 pt-4">
      <p className="text-sm font-semibold text-slate-700 mb-1">Rutas de este almacén</p>
      <p className="text-xs text-slate-500 mb-3">
        Circuitos de reparto que salen de aquí -- asigna uno ya creado (estuviera libre o perteneciendo a otro almacén) o
        crea uno nuevo directamente para este almacén.
      </p>

      {assigned.length === 0 ? (
        <p className="text-xs text-slate-400 mb-3">Todavía no hay ninguna ruta asignada a este almacén.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {assigned.map((z) => (
            <li key={z.id} className="bg-slate-50 rounded-lg px-3 py-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{z.name}</span>
                <button
                  type="button"
                  onClick={() => unassignMutation.mutate(z.id)}
                  className="text-xs text-red-500 hover:text-red-600 font-medium"
                >
                  Quitar
                </button>
              </div>
              {/* Fase 25: QR de ruta (centro + este circuito + transportista)
                  -- ver comentario en RouteQrRow más abajo. */}
              <RouteQrRow warehouseId={warehouseId} deliveryZoneId={z.id} onError={onError} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 mb-2">
        <select
          value={otherZoneId}
          onChange={(e) => setOtherZoneId(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 text-sm px-2.5 py-1.5"
        >
          <option value="">Asignar una ruta ya creada…</option>
          {others.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} {z.warehouse ? `(actualmente: ${z.warehouse.name})` : "(sin almacén)"}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!otherZoneId || assignMutation.isPending}
          onClick={() => assignMutation.mutate(otherZoneId)}
          className="text-sm px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          Asignar
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newZoneName}
          onChange={(e) => setNewZoneName(e.target.value)}
          placeholder="Nombre de la ruta nueva (p. ej. MAD1)"
          className="flex-1 rounded-lg border border-slate-300 text-sm px-2.5 py-1.5"
        />
        <button
          type="button"
          disabled={!newZoneName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate(newZoneName.trim())}
          className="text-sm px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          + Nueva ruta
        </button>
      </div>
    </div>
  );
}

// Fase 25 ("usuarios app" sub-fase 3): QR de ruta -- un único QR fijo por
// combinación centro + circuito + transportista, que sustituye al QR por
// vehículo/conductor como puerta de entrada a la App Conductor (ver
// comentario en RouteQrToken, schema.prisma). Se elige el transportista para
// ESTE circuito y se genera/consulta su QR -- un mismo circuito puede tener
// varios transportistas distintos, cada uno con el suyo propio (igual que ya
// pasa con las tarifas por circuito+transportista).
interface CarrierOption {
  id: string;
  legalName: string;
}

function RouteQrRow({
  warehouseId,
  deliveryZoneId,
  onError,
}: {
  warehouseId: string;
  deliveryZoneId: string;
  onError: (message: string) => void;
}) {
  const [carrierId, setCarrierId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
  });
  const carrierName = carriersQuery.data?.items.find((c) => c.id === carrierId)?.legalName ?? "";

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <select
        value={carrierId}
        onChange={(e) => setCarrierId(e.target.value)}
        className="flex-1 rounded-lg border border-slate-300 text-xs px-2 py-1.5"
      >
        <option value="">QR de ruta para transportista…</option>
        {carriersQuery.data?.items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.legalName}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!carrierId}
        onClick={() => setModalOpen(true)}
        className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
      >
        Ver QR
      </button>
      {modalOpen && carrierId && (
        <RouteQrModal
          warehouseId={warehouseId}
          deliveryZoneId={deliveryZoneId}
          carrierId={carrierId}
          carrierName={carrierName}
          onClose={() => setModalOpen(false)}
          onError={onError}
        />
      )}
    </div>
  );
}

// Mismo patrón (y mismo servicio gratuito de generación de imagen QR,
// api.qrserver.com) que VehicleQrModal en VehiclesPage.tsx.
function RouteQrModal({
  warehouseId,
  deliveryZoneId,
  carrierId,
  carrierName,
  onClose,
  onError,
}: {
  warehouseId: string;
  deliveryZoneId: string;
  carrierId: string;
  carrierName: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const scopeParams = { warehouseId, deliveryZoneId, carrierId };

  const tokenQuery = useQuery({
    queryKey: ["route-qr-token", warehouseId, deliveryZoneId, carrierId],
    queryFn: async () => (await api.get("/route-qr", { params: scopeParams })).data as { token: string | null },
  });

  const issueMutation = useMutation({
    mutationFn: async () => (await api.post("/route-qr", scopeParams)).data as { token: string },
    onSuccess: () => tokenQuery.refetch(),
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo generar el QR"),
  });

  const token = issueMutation.data?.token ?? tokenQuery.data?.token ?? null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">QR de ruta — {carrierName}</h3>
        <p className="text-xs text-slate-500 mb-4">
          El conductor lo escanea desde la App Conductor para identificarse (nombre, DNI, teléfono, matrícula) y
          ver/operar la ruta de este circuito, cualquier día que este transportista tenga una asignada.
        </p>

        {tokenQuery.isLoading && <p className="text-sm text-slate-400 py-8">Cargando…</p>}

        {!tokenQuery.isLoading && token && (
          <>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(token)}`}
              alt={`Código QR de ruta para ${carrierName}`}
              className="mx-auto rounded-lg border border-slate-200"
              width={220}
              height={220}
            />
            <p className="text-[10px] font-mono text-slate-400 mt-3 break-all">{token}</p>
          </>
        )}

        {!tokenQuery.isLoading && !token && (
          <p className="text-sm text-slate-400 py-6">Todavía no se ha generado un QR para este transportista en este circuito.</p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending}
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {token ? "Generar nuevo (invalida el anterior)" : "Generar QR"}
          </button>
          <button onClick={onClose} className="text-sm text-slate-500 px-4 py-2">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
