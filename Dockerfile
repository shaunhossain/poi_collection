# Multi-stage Dockerfile for Next.js Standalone
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Arguments for client-side Next.js bundle
ARG NEXT_PUBLIC_BARIKOI_API_KEY=MTYyNDpFQVg4VlFaMUtB
ARG NEXT_PUBLIC_BARIKOI_ADMIN_KEY=ak_s0QRbSrx_B3eEHSAXOt8k4SFERRL2SxPC-7hvbWLE
ARG NEXT_PUBLIC_MAP_STYLE_URL=https://map.barikoi.com/styles/osm_barikoi_v1/style.json
ARG NEXT_PUBLIC_THIRDEYE_TILE_URL=https://tiles.bmapsbd.com/ThirdEye360
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ARG NEXT_PUBLIC_DEFAULT_LAT=23.8103
ARG NEXT_PUBLIC_DEFAULT_LNG=90.4125
ARG NEXT_PUBLIC_DEFAULT_ZOOM=14

ENV NEXT_PUBLIC_BARIKOI_API_KEY=$NEXT_PUBLIC_BARIKOI_API_KEY
ENV NEXT_PUBLIC_BARIKOI_ADMIN_KEY=$NEXT_PUBLIC_BARIKOI_ADMIN_KEY
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
ENV NEXT_PUBLIC_THIRDEYE_TILE_URL=$NEXT_PUBLIC_THIRDEYE_TILE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_DEFAULT_LAT=$NEXT_PUBLIC_DEFAULT_LAT
ENV NEXT_PUBLIC_DEFAULT_LNG=$NEXT_PUBLIC_DEFAULT_LNG
ENV NEXT_PUBLIC_DEFAULT_ZOOM=$NEXT_PUBLIC_DEFAULT_ZOOM
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy assets and standalone server
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
