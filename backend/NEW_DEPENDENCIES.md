# Añadir al backend (npm install --workspace=backend):

npm install express-rate-limit node-cron socket.io
npm install -D @types/node-cron

# Añadir al backoffice (npm install --workspace=apps/backoffice):

npm install socket.io-client

# Añadir a la app conductor (npm install --workspace=apps/app-conductor):
# (ya se pidió html5-qrcode en el delta anterior; sin dependencias nuevas
#  para el modo offline — offlineQueue.ts usa localStorage nativo)

# Añadir a carrier-portal (npm install --workspace=apps/carrier-portal):

npm install socket.io-client

# Añadir al backend, pasada 5 (KPIs/BI ampliado):

npm install exceljs pdfkit nodemailer cron-parser
npm install -D @types/pdfkit @types/nodemailer

# Ya presentes en el proyecto y reutilizadas sin cambios: express, zod,
# @prisma/client, jest, supertest, ts-jest.
