-- Fase 24 ("usuarios app" sub-fase 2): migración de datos de un solo uso
-- para que los almacenes que ya existen no se queden con el emisor del
-- albarán/DeCA en blanco al desplegar esta fase (antes ese dato era único
-- por empresa, en `company`; ahora es por centro, en `warehouse` -- ver
-- document-pdf.service.ts y el comentario en el modelo Warehouse de
-- schema.prisma).
--
-- Copia los datos fiscales que ya hubiera en `company` (razón social, CIF,
-- teléfono, email, registro mercantil) a cada almacén activo de esa empresa
-- que TODAVÍA no tenga su propio `fiscal_name`/`tax_id` rellenado -- así
-- ningún documento generado justo después del despliegue sale con el
-- cargador en blanco. Si `company` tampoco tenía esos datos rellenados, el
-- almacén se queda igual de vacío que antes (el PDF cae entonces en el
-- valor de respaldo BIGMAT_CARGADOR_FALLBACK -- ver document-pdf.service.ts
-- -- o, para el albarán, en el propio nombre del almacén).
--
-- Ejecutar ESTE script UNA SOLA VEZ, DESPUÉS de `prisma db push` (o de
-- desplegar el backend con el schema nuevo, que ya incluye las columnas
-- warehouse.fiscal_name/tax_id/phone/email/mercantile_registry_text).
-- `prisma db push` no copia datos por sí solo -- de ahí este script.
--
-- Seguro de re-ejecutar: solo toca almacenes con fiscal_name Y tax_id
-- todavía en blanco, así que una segunda ejecución no pisa nada que ya se
-- haya editado a mano desde Maestros > Almacenes.

BEGIN;

UPDATE warehouse w
SET
  fiscal_name = c.name,
  tax_id = c.tax_id,
  phone = COALESCE(w.phone, c.phone),
  email = COALESCE(w.email, c.email),
  mercantile_registry_text = COALESCE(w.mercantile_registry_text, c.mercantile_registry_text)
FROM company c
WHERE w.company_id = c.id
  AND w.active = true
  AND w.fiscal_name IS NULL
  AND w.tax_id IS NULL;

COMMIT;

-- Tras ejecutar esto, revisa en Maestros > Almacenes que cada centro
-- muestre los datos fiscales correctos antes de generar el primer
-- albarán/DeCA real -- especialmente si tienes más de un almacén y alguno
-- factura como una sociedad distinta a la que había en "TMS Configuración"
-- (ahí solo se podía guardar una única razón social/CIF para todo el TMS).
