# syntax=docker/dockerfile:1
#
# SIN `RUN --mount=type=cache`. Los tenía, para que en el VPS los cache mounts
# persistieran entre deploys (npm ci sin re-descargar, next build incremental).
# Con el deploy en Container Apps la imagen se construye con `az acr build`, y
# ACR Tasks NO usa BuildKit: falla con
#   "the --mount option requires BuildKit"
# antes de instalar nada. Verificado 2026-07-28 — el workflow deploy-azure.yml
# no podía buildear por esto.
#
# Tampoco se pierde gran cosa: cada run de ACR arranca en un contenedor limpio,
# así que un cache mount no persistiría entre builds de todos modos. El cacheo
# entre deploys lo da el layer cache del registry.
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlinea las NEXT_PUBLIC_ en el bundle del cliente al compilar, así que
# tienen que existir ACÁ, en build-time. Antes venían de .env.production, que
# viajaba dentro de la imagen y se llevaba puestos todos los secretos del
# archivo — ver el comentario en .dockerignore.
#
# Van como ARG y no como secreto: son públicas por definición, terminan
# servidas a cualquier browser que abra la app.
ARG NEXT_PUBLIC_CLIENT_ID=""
ARG NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=""
ARG NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY=""
ARG NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY=""
ARG NEXT_PUBLIC_PADDLE_PRO_MONTHLY=""
ARG NEXT_PUBLIC_PADDLE_PRO_YEARLY=""
ARG NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY=""
ARG NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY=""
ENV NEXT_PUBLIC_CLIENT_ID=$NEXT_PUBLIC_CLIENT_ID \
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=$NEXT_PUBLIC_PADDLE_CLIENT_TOKEN \
    NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY=$NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY \
    NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY=$NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY \
    NEXT_PUBLIC_PADDLE_PRO_MONTHLY=$NEXT_PUBLIC_PADDLE_PRO_MONTHLY \
    NEXT_PUBLIC_PADDLE_PRO_YEARLY=$NEXT_PUBLIC_PADDLE_PRO_YEARLY \
    NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY=$NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY \
    NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY=$NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY

RUN npm run build

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
