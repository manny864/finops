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
