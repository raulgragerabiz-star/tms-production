-- Fase 23 ("usuarios app"): migración de datos de un solo uso para pasar del
-- modelo de 4 roles (admin_empresa, planificador, gestor_flota,
-- administracion) al modelo nuevo de exactamente 2 (Administrador =
-- admin_empresa, Planificador = planificador), y para que ningún
-- Planificador ya existente se quede bloqueado sin poder crear/editar nada
-- al desplegar esta fase (con el nuevo AppUser.warehouse_id, un Planificador
-- SIN centro asignado no puede escribir en ningún centro -- ver
-- warehouse-scope.ts).
--
-- Ejecutar ESTE script UNA SOLA VEZ, DESPUÉS de `prisma db push` (o de
-- desplegar el backend con el schema nuevo, que ya incluye la columna
-- app_user.warehouse_id) y ANTES de que el equipo empiece a usar la
-- aplicación con este cambio desplegado. `prisma db push`/`prisma db seed`
-- no borran ni migran filas existentes por sí solos -- de ahí este script.
--
-- Seguro de re-ejecutar: cada paso comprueba antes de tocar nada.

BEGIN;

-- 1) Cualquier usuario con el rol "gestor_flota" o "administracion" pasa a
--    tener también "admin_empresa" (ambos roles legacy tenían permisos de
--    escritura sobre masters/tarifas/facturación, más cerca de Administrador
--    que de Planificador).
INSERT INTO user_role (user_id, role_id)
SELECT ur.user_id, r_admin.id
FROM user_role ur
JOIN role r_old ON r_old.id = ur.role_id AND r_old.code IN ('gestor_flota', 'administracion')
JOIN role r_admin ON r_admin.code = 'admin_empresa'
ON CONFLICT DO NOTHING;

-- 2) Se quitan las asignaciones a los roles legacy (ya tienen admin_empresa
--    del paso 1) y cualquier otro rol que no sea ya uno de los 2 finales.
DELETE FROM user_role
WHERE role_id IN (SELECT id FROM role WHERE code IN ('gestor_flota', 'administracion'));

-- 3) Se eliminan los roles legacy (y sus permisos asociados).
DELETE FROM role_permission
WHERE role_id IN (SELECT id FROM role WHERE code IN ('gestor_flota', 'administracion'));

DELETE FROM role
WHERE code IN ('gestor_flota', 'administracion');

-- 4) Cualquier usuario interno que se quede con MÁS de un rol tras el paso 1
--    (por ejemplo, ya tenía planificador Y gestor_flota) se deja solo con
--    admin_empresa -- el nuevo modelo exige exactamente un rol por cuenta
--    (ver resolveSingleInternalRoleCode en users.routes.ts). Si de verdad
--    hace falta que esa persona sea Planificador en vez de Administrador,
--    corrígelo a mano después desde Maestros > Usuarios.
DELETE FROM user_role ur
USING role r
WHERE ur.role_id = r.id
  AND r.code = 'planificador'
  AND ur.user_id IN (
    SELECT user_id FROM user_role GROUP BY user_id HAVING COUNT(*) > 1
  );

-- 5) Centro por defecto para usuarios internos que se queden sin
--    warehouse_id: si la empresa tiene EXACTAMENTE un almacén activo, se les
--    asigna ese (evita que un Planificador quede bloqueado el primer día).
--    Con más de un almacén, se deja NULL a propósito -- revísalo a mano en
--    Maestros > Usuarios, porque aquí no hay forma segura de adivinar a qué
--    centro pertenece cada Planificador.
UPDATE app_user au
SET warehouse_id = w.only_warehouse_id
FROM (
  SELECT company_id, MIN(id) AS only_warehouse_id
  FROM warehouse
  WHERE active = true
  GROUP BY company_id
  HAVING COUNT(*) = 1
) w
WHERE au.company_id = w.company_id
  AND au.user_type = 'internal'
  AND au.warehouse_id IS NULL
  AND au.id IN (
    SELECT ur.user_id FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE r.code = 'planificador'
  );

COMMIT;

-- Tras ejecutar esto, revisa en Maestros > Usuarios que cada Administrador y
-- Planificador tenga el rol y el centro correctos antes de que el equipo
-- empiece a trabajar -- especialmente si la empresa ya tiene más de un
-- almacén activo (el paso 5 no pudo adivinar el centro en ese caso).
