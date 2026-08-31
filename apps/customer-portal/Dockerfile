# Mismo patrón multi-stage ya usado en apps/backoffice, apps/carrier-portal
# y apps/app-conductor: build de Vite en una etapa, servido por nginx en la
# etapa final. No requiere el fix de Alpine/OpenSSL (eso solo aplica a la
# imagen del backend, que usa Prisma con binarios nativos).

# ---- deps + build ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
