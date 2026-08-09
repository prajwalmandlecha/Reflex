# --- Dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# --- Build ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# BACKEND_URL must be set at build time because Next.js compiles
# rewrites into the routes manifest during `next build`.
# Local dev (outside Docker) falls back to localhost:8000 via next.config.js.
ENV BACKEND_URL=http://backend:8000

RUN npm run build

# --- Runtime ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Next.js standalone server listens on localhost by default — bind to
# 0.0.0.0 so it's reachable from outside the container.
ENV HOSTNAME=0.0.0.0

# Next.js standalone output includes only the files needed at runtime.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
