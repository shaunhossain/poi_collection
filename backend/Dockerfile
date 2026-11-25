# Multi-stage Dockerfile for NestJS POI Extraction Backend
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-ben
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/crops

EXPOSE 4000

CMD ["node", "dist/main"]
