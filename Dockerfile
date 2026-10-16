# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# checkov:skip=CKV_DOCKER_2:owner=CloudOps; expires=2027-01-15; Deploy checks /api/health after rollout; migrator execution status is monitored. No image-level HEALTHCHECK; adding a runtime probe remains deferred.
#
# Node 22 Alpine: OCI index verified against Docker Hub; update through review.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public client configuration is projected by the dynamic layout at runtime.
# No environment-specific identity or billing configuration enters the build.
RUN npm run build

# Imagen del job de migraciones (INFRA-08). Necesita scripts/, migraciones, tsx y
# node_modules completos, que el runner podado no tiene; por eso parte de builder.
# Corre sin root. A propósito NO se hace chown de /app: el código y node_modules
# quedan de root y el usuario sólo los lee. Escribe únicamente en su $HOME
# (logs/cache de npm) y en /tmp (cache de tsx).
FROM builder AS migrator
RUN addgroup --system --gid 1002 migrate \
 && adduser --system --uid 1002 --ingroup migrate --home /home/migrate migrate
USER migrate
CMD ["npm", "run", "migrate"]

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Adjuntos de soporte: el mountpoint debe existir con ownership de la app
# ANTES de USER nextjs — el named volume hereda este ownership al crearse;
# sin esto, el volumen montaría como root y la app (uid 1001) no podría escribir.
RUN mkdir -p /app/data/support-attachments && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT 3000
# Docker inyecta automaticamente HOSTNAME=<container_id> en todo contenedor.
# El server.js standalone de Next.js usa process.env.HOSTNAME para decidir
# en que interfaz escuchar, asi que sin este override termina bindeando
# solo a la IP especifica del contenedor (no a localhost/127.0.0.1),
# rompiendo cualquier healthcheck/proceso interno que hable con localhost:3000.
ENV HOSTNAME "0.0.0.0"
CMD ["node", "server.js"]
