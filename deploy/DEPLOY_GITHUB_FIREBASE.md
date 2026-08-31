# Despliegue para presentación — GitHub + Firebase + Cloud Run

## Por qué esta combinación (y no solo Firebase)

Firebase Hosting sirve estáticos (las 4 apps React) de forma excelente y
gratuita. Pero tu backend es Node/Express con Prisma sobre PostgreSQL — eso
no encaja en Firestore (NoSQL) ni corre bien como Cloud Function pura por
los jobs programados (`node-cron`) y Socket.io. La solución que **no te
deja en un callejón sin salida** para completar el aplicativo después:

| Pieza | Dónde | Por qué |
|---|---|---|
| 4 apps frontend (backoffice, carrier-portal, driver-app, customer-portal) | **Firebase Hosting** (multi-site, 1 proyecto) | Gratis, CDN, deploy en segundos, dominios `*.web.app` listos para la demo |
| Backend (Express + Prisma) | **Cloud Run** (mismo proyecto GCP que Firebase) | Corre tu Docker ya existente sin cambios de código; escala a cero (barato) o se puede fijar `min-instances=1` si necesitas los cron jobs vivos |
| Base de datos | **Neon** (Postgres gestionado, capa gratuita) | Prisma lo trata como cualquier Postgres — cero cambios de schema/ORM. Cloud SQL sería la opción "todo Google", pero Neon se monta en 5 minutos sin tarjeta |
| CI/CD | **GitHub Actions** | Ya tienes el patrón (build+push imagen) del proyecto original; se adapta a Cloud Run + Firebase Hosting con dos actions oficiales |

Esta arquitectura es la misma que necesitarías en producción real — no es
un montaje de usar y tirar para la demo. Cuando quieras aplicar el bloque
DIFERIBLE (GPS en vivo, jobs, IA...) después del martes, todo sigue
funcionando igual, solo ajustas `min-instances` en Cloud Run si necesitas
que los cron jobs y Socket.io estén siempre activos.

---

## 0. Prerrequisitos (10 min)

- [ ] Cuenta de Google (para Firebase/GCP) — puede ser personal, no hace falta empresa.
- [ ] Cuenta en [neon.tech](https://neon.tech) (login con GitHub, gratis).
- [ ] `firebase-tools` instalado: `npm install -g firebase-tools`.
- [ ] `gcloud` CLI instalado (para el primer despliegue manual de Cloud Run; después lo hace GitHub Actions solo). En Codespaces: `curl https://sdk.cloud.google.com | bash` si no está ya.
- [ ] Repo en GitHub con permisos de admin (para configurar Secrets).

---

## 1. Base de datos — Neon (10 min)

1. Entra en https://console.neon.tech, "New Project".
2. Nombre: `tms-production` (o `tms-demo` si quieres separarlo del futuro real).
3. Región: elige la más cercana a donde esté Cloud Run (ej. `europe-west1` si vas a desplegar el backend ahí).
4. Copia el **connection string** que te da Neon — algo como:
   ```
   postgresql://usuario:password@ep-xxxx.eu-central-1.aws.neon.tech/tms?sslmode=require
   ```
5. Guárdalo, lo necesitas en el paso 4 (Secrets de GitHub) y para correr las migraciones manuales una vez.

### Aplicar el schema
Desde tu máquina/Codespaces, con `DATABASE_URL` apuntando a Neon:
```bash
cd backend
export DATABASE_URL="postgresql://usuario:password@ep-xxxx.../tms?sslmode=require"
npx prisma db push
```
Después, ejecuta los SQL manuales del bloque crítico contra Neon (usa el
connection string de arriba con `psql` o cualquier cliente Postgres):
```bash
psql "$DATABASE_URL" -f prisma/migrations_manual/v1_1_segmentation.sql
```

---

## 2. Proyecto de Firebase / GCP (10 min)

1. Ve a https://console.firebase.google.com → "Añadir proyecto".
2. Nombre: `tms-<tuempresa>` (el ID de proyecto será algo como `tms-tuempresa-a1b2c`, lo usarás en varios sitios).
3. Desactiva Google Analytics si no lo necesitas (no hace falta para esto).
4. Una vez creado, en el propio Firebase Console: **Build → Hosting → Comenzar**. Esto habilita Hosting en el proyecto (no hace falta terminar el asistente, solo activarlo).
5. Habilita facturación del proyecto GCP (Cloud Run requiere el plan "Blaze" de Firebase, que sigue siendo gratis dentro de los límites del free tier de Cloud Run — no te van a cobrar por una demo). Firebase Console → Configuración del proyecto → Uso y facturación → Modificar plan → Blaze.

### Login local y vinculación del repo
```bash
firebase login
cd tu-repo-tms
firebase init hosting
```
Cuando pregunte:
- "Use an existing project" → selecciona el proyecto que acabas de crear.
- "What do you want to use as your public directory?" → dilo que no, vas a configurar **multi-site** manualmente (ver paso 3), cancela con Ctrl+C si el asistente insiste en un único sitio, y edita `firebase.json` a mano como se indica abajo.

---

## 3. Firebase Hosting — 4 sitios (multi-site)

Cada app necesita su propio "site" dentro del mismo proyecto Firebase, porque
son 4 builds independientes con dominios distintos.

```bash
firebase hosting:sites:create tms-backoffice
firebase hosting:sites:create tms-carrier-portal
firebase hosting:sites:create tms-driver-app
firebase hosting:sites:create tms-customer-portal
```

Esto te da 4 dominios del tipo `https://tms-backoffice.web.app`,
`https://tms-carrier-portal.web.app`, etc. — perfectos para la
presentación (cortos, con HTTPS, sin configurar nada de DNS).

Sustituye `.firebaserc` y `firebase.json` de tu repo por los de
`deploy/firebase/` de este paquete (ajusta el `projectId` al tuyo).

---

## 4. Backend — Cloud Run

### 4.1 Primer despliegue manual (para verificar que funciona)
```bash
cd backend
gcloud auth login
gcloud config set project tms-tuempresa-a1b2c   # tu ID real de proyecto

gcloud run deploy tms-backend \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars DATABASE_URL="postgresql://...(tu connection string de Neon)" \
  --set-env-vars NODE_ENV=production \
  --set-env-vars DISABLE_SCHEDULED_JOBS=true \
  --port 4000
```

`--source .` hace que Cloud Run construya la imagen a partir de tu
Dockerfile existente automáticamente (usa Cloud Build por debajo) — no
necesitas Artifact Registry configurado a mano para esta primera prueba.

`DISABLE_SCHEDULED_JOBS=true` es importante: Cloud Run con
`min-instances=0` (el modo gratuito) apaga el contenedor cuando no hay
tráfico, así que un `node-cron` en proceso no es fiable ahí. Para la
presentación no lo necesitas (los jobs son todos del bloque DIFERIBLE). Si
más adelante quieres jobs fiables, sube `min-instances` a 1 (tiene coste) o
migra los jobs a Cloud Scheduler + un endpoint HTTP (ver §7).

Al terminar, `gcloud` te da una URL tipo:
```
https://tms-backend-xxxxx-ew.a.run.app
```
Esa es la URL de tu API — la necesitas para el siguiente paso.

### 4.2 CORS del backend
Añade los 4 dominios de Firebase Hosting a la whitelist de CORS de tu
`app.ts`:
```ts
const allowedOrigins = [
  "https://tms-backoffice.web.app",
  "https://tms-carrier-portal.web.app",
  "https://tms-driver-app.web.app",
  "https://tms-customer-portal.web.app",
  // + los orígenes de Codespaces que ya tenías, no los quites
];
```

---

## 5. Frontends — variables de entorno de build

Cada app usa `resolveApiBaseUrl()`, que ya soporta un override por
`VITE_API_BASE_URL` (lo añadimos en la pasada del Portal Cliente y está en
el mismo patrón en las otras 3 apps). Para el build de Firebase, defines
esa variable ANTES de compilar:

```bash
# En cada apps/<nombre>/.env.production (crear si no existe):
echo "VITE_API_BASE_URL=https://tms-backend-xxxxx-ew.a.run.app" > apps/backoffice/.env.production
echo "VITE_API_BASE_URL=https://tms-backend-xxxxx-ew.a.run.app" > apps/carrier-portal/.env.production
echo "VITE_API_BASE_URL=https://tms-backend-xxxxx-ew.a.run.app" > apps/app-conductor/.env.production
echo "VITE_API_BASE_URL=https://tms-backend-xxxxx-ew.a.run.app" > apps/customer-portal/.env.production
```

Sin esto, `resolveApiBaseUrl()` intentaría el patrón de detección de
Codespaces (regex de subdominio) y fallaría en un dominio `.web.app` — por
eso el override explícito es obligatorio aquí, no opcional.

### Build y deploy manual (primera vez, para verificar)
```bash
cd apps/backoffice && npm install && npm run build
firebase deploy --only hosting:tms-backoffice

cd ../carrier-portal && npm install && npm run build
firebase deploy --only hosting:tms-carrier-portal

cd ../app-conductor && npm install && npm run build
firebase deploy --only hosting:tms-driver-app

cd ../customer-portal && npm install && npm run build
firebase deploy --only hosting:tms-customer-portal
```

Prueba cada URL en el navegador antes de seguir.

---

## 6. Automatizar con GitHub Actions (para no repetir esto a mano)

1. Genera un token de Firebase CI:
   ```bash
   firebase login:ci
   ```
   Copia el token que te da.

2. Genera credenciales de servicio de GCP para que GitHub pueda desplegar
   en Cloud Run:
   ```bash
   gcloud iam service-accounts create github-deployer \
     --display-name "GitHub Actions Deployer"

   gcloud projects add-iam-policy-binding tms-tuempresa-a1b2c \
     --member="serviceAccount:github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com" \
     --role="roles/run.admin"

   gcloud projects add-iam-policy-binding tms-tuempresa-a1b2c \
     --member="serviceAccount:github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com" \
     --role="roles/iam.serviceAccountUser"

   gcloud projects add-iam-policy-binding tms-tuempresa-a1b2c \
     --member="serviceAccount:github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com" \
     --role="roles/cloudbuild.builds.editor"

   gcloud projects add-iam-policy-binding tms-tuempresa-a1b2c \
     --member="serviceAccount:github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com" \
     --role="roles/firebasehosting.admin"

   gcloud projects add-iam-policy-binding tms-tuempresa-a1b2c \
     --member="serviceAccount:github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com" \
     --role="roles/storage.admin"

   gcloud iam service-accounts keys create gcp-key.json \
     --iam-account github-deployer@tms-tuempresa-a1b2c.iam.gserviceaccount.com
   ```
   `gcp-key.json` es un fichero JSON — su CONTENIDO completo va a un Secret.
   (`roles/storage.admin` lo necesita Cloud Build para subir la imagen
   intermedia al construir el contenedor con `--source`.)

3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crea:

   | Secret | Valor |
   |---|---|
   | `FIREBASE_TOKEN` | El token del paso 1 |
   | `GCP_SA_KEY` | El contenido completo de `gcp-key.json` |
   | `GCP_PROJECT_ID` | `tms-tuempresa-a1b2c` |
   | `DATABASE_URL` | Tu connection string de Neon |
   | `VITE_API_BASE_URL` | La URL de Cloud Run del paso 4.1 |

4. Borra `gcp-key.json` de tu disco local (ya está en el Secret, no hace
   falta conservarlo suelto):
   ```bash
   rm gcp-key.json
   ```

5. Copia `deploy/github-actions/deploy.yml` de este paquete a
   `.github/workflows/deploy.yml` en tu repo. Se dispara en cada push a
   `main` y despliega backend (Cloud Run) + las 4 apps (Firebase Hosting)
   automáticamente.

6. Haz push a `main` y observa la pestaña **Actions** de GitHub — el
   despliegue completo debería tardar 3-5 minutos.

---

## 7. Jobs programados sin coste — Cloud Scheduler (opcional, para cuando quieras completar el bloque diferible)

Si más adelante activas los jobs (limpieza QR, KPIs, IA...) y no quieres
pagar por `min-instances=1` en Cloud Run, la alternativa estándar en GCP
es exponer cada job como un endpoint HTTP protegido
(`POST /internal/jobs/:jobName`) y disparar cada uno con **Cloud
Scheduler** (gratis hasta 3 jobs, después céntimos/mes):

```bash
gcloud scheduler jobs create http cleanup-qr-tokens \
  --schedule="0 3 * * *" \
  --uri="https://tms-backend-xxxxx-ew.a.run.app/internal/jobs/cleanup-qr-tokens" \
  --http-method=POST \
  --headers="Authorization=Bearer TU_SECRETO_INTERNO"
```

Esto **no es necesario para la presentación** — se deja documentado aquí
para cuando retomes el bloque diferible sin tener que rediseñar nada.

---

## 8. Checklist final antes de la presentación

- [ ] Neon: `prisma db push` + SQL manual del bloque crítico ejecutados.
- [ ] Cloud Run: backend responde en su URL (`curl https://tms-backend-xxxxx-ew.a.run.app/api/health` o el endpoint que uses de smoke test).
- [ ] CORS del backend incluye los 4 dominios `.web.app`.
- [ ] Los 4 `.env.production` tienen `VITE_API_BASE_URL` apuntando a Cloud Run.
- [ ] Las 4 apps cargan en sus URLs de Firebase Hosting sin errores de CORS en consola.
- [ ] Login funciona en las 4 apps contra el backend real.
- [ ] `smoke-test.sh` (de este mismo paquete) ejecutado contra la URL de Cloud Run.
- [ ] GitHub Actions en verde en el último push a `main`.

## 9. Qué NO monté aquí (a propósito, bloque diferible)
- Dominio propio (puedes añadirlo después en Firebase Hosting → dominios personalizados, 10 min).
- Socket.io / GPS en vivo: Cloud Run soporta WebSockets, pero con
  `min-instances=0` las conexiones se cortan al escalar a cero — si lo
  necesitas para la demo, avísame y subimos `min-instances=1` solo ese día.
- Cloud Scheduler para jobs (ver §7) — no bloquea la presentación.
- Backups automáticos de Neon (la capa gratuita ya hace snapshots básicos, suficiente para una demo).
