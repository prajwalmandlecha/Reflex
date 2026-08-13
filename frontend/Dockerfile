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
# Override with --build-arg BACKEND_URL=... when deploying to ACA.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL

# NEXT_PUBLIC_API_URL makes the browser call the backend DIRECTLY (cross-origin)
# instead of relying on Next.js rewrites. Next.js rewrites to an external URL
# return a 301 redirect, which the browser follows as GET — converting POST
# requests (like /auth/login) into GET and causing 405 Method Not Allowed.
# Setting this to the backend FQDN bypasses the rewrite entirely. Backend CORS
# is "*" so cross-origin calls work. Leave empty for same-origin local dev.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# NEXT_PUBLIC_GATEWAY_URL is the gateway's MCP endpoint host. The frontend's
# AgentConnectionSnippet auto-generates the MCP URL from window.location.hostname
# (the frontend host) when this is unset, which is WRONG when the gateway is a
# separate container app on a different FQDN. Bake in the gateway FQDN so the
# generated MCP config points at the real gateway. Leave empty for local dev
# (localhost:8080 fallback).
ARG NEXT_PUBLIC_GATEWAY_URL=
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL

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
