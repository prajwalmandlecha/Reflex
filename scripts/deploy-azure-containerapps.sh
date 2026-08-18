#!/usr/bin/env bash
# Deploy Reflex to Azure Container Apps (ACA).
#
# Uses the ACA monthly free grant:
#   180,000 vCPU-seconds, 360,000 GiB-seconds, 2M requests
# (new subscriptions only — check your subscription's free grant status).
#
# Prereqs: az CLI, docker, logged in (az login), and a resource group.
# Usage:   ./scripts/deploy-azure-containerapps.sh
set -euo pipefail

# ---- Config (override via env) ----
# NOTE: "Azure for Students" subscriptions have a region-restriction policy
# (sys.regionrestriction). The ONLY allowed regions are:
#   austriaeast, malaysiawest, southeastasia, eastasia, koreacentral
# India (centralindia / indiasouthcentral) is NOT allowed.
# Closest to India: southeastasia (Singapore) or eastasia (Hong Kong).
# Use a DISTINCT resource group name per region — an RG can't be recreated
# in a different location once it exists (e.g. reflex-rg already exists in eastus).
RG="${AZURE_RG:-reflex-rg-sea}"
LOCATION="${AZURE_LOCATION:-southeastasia}"
ACR_NAME="${ACR_NAME:-reflexacr}"
ENV_NAME="${ACA_ENV:-reflex-env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.azure.yml}"

# Secrets (generate if not provided)
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
FERNET_KEY="${FERNET_KEY:-$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' 2>/dev/null || echo 'change-me')}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"

echo "==> Resource group: $RG ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" -o none

echo "==> Creating Azure Container Registry: $ACR_NAME"
az acr create --resource-group "$RG" --name "$ACR_NAME" --sku Basic --admin-enabled true -o none
ACR_LOGIN_SERVER="$(az acr show --resource-group "$RG" --name "$ACR_NAME" --query loginServer -o tsv)"
az acr login --name "$ACR_NAME"

echo "==> Building & pushing images to ACR"
# NOTE: ACR Tasks (az acr build) is blocked on "Azure for Students" subs
# (TasksOperationsNotAllowed). Build locally and push instead.
# Detect container tool: prefer podman (docker may be an alias that isn't
# available in non-interactive scripts).
if command -v podman >/dev/null 2>&1; then
  CT="podman"
elif command -v docker >/dev/null 2>&1; then
  CT="docker"
else
  echo "ERROR: no container tool found (need docker or podman)" >&2
  exit 1
fi
echo "Using container tool: $CT"

$CT build -t "$ACR_LOGIN_SERVER/reflex-backend:latest" ./backend
$CT build -t "$ACR_LOGIN_SERVER/reflex-gateway:latest" ./gateway

# Frontend: bake the backend FQDN into the build so the browser calls the
# backend DIRECTLY (cross-origin). Next.js rewrites to an external URL return
# a 301 redirect, which the browser follows as GET — converting POST requests
# (like /auth/login) into GET and causing 405 Method Not Allowed. Setting
# NEXT_PUBLIC_API_URL to the backend FQDN bypasses the rewrite entirely.
# Backend CORS is "*" so cross-origin calls work.
BACKEND_FQDN="$(az containerapp show --resource-group "$RG" --name backend --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo '')"
GATEWAY_FQDN="$(az containerapp show --resource-group "$RG" --name gateway --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo '')"
if [ -n "$BACKEND_FQDN" ]; then
  echo "==> Frontend will call backend directly at: https://$BACKEND_FQDN"
  # NEXT_PUBLIC_GATEWAY_URL bakes the gateway FQDN into the build so the
  # AgentConnectionSnippet generates the correct MCP URL (the gateway is a
  # separate container app, not on the frontend host).
  GATEWAY_ARG=()
  if [ -n "$GATEWAY_FQDN" ]; then
    echo "==> MCP gateway URL baked in: https://$GATEWAY_FQDN/mcp"
    GATEWAY_ARG=(--build-arg NEXT_PUBLIC_GATEWAY_URL="https://$GATEWAY_FQDN/mcp")
  fi
  $CT build \
    --build-arg BACKEND_URL="https://$BACKEND_FQDN" \
    --build-arg NEXT_PUBLIC_API_URL="https://$BACKEND_FQDN" \
    "${GATEWAY_ARG[@]}" \
    -t "$ACR_LOGIN_SERVER/reflex-frontend:latest" ./frontend
else
  echo "==> WARNING: backend FQDN not found; building frontend same-origin (rewrites may 301-redirect POSTs)"
  $CT build -t "$ACR_LOGIN_SERVER/reflex-frontend:latest" ./frontend
fi

$CT push "$ACR_LOGIN_SERVER/reflex-backend:latest"
$CT push "$ACR_LOGIN_SERVER/reflex-gateway:latest"
$CT push "$ACR_LOGIN_SERVER/reflex-frontend:latest"

echo "==> Creating Container Apps Environment: $ENV_NAME"
az containerapp env create \
  --resource-group "$RG" \
  --name "$ENV_NAME" \
  --location "$LOCATION" -o none

echo "==> Deploying compose stack to ACA"
# Export secrets so the compose file's ${VAR} interpolation works.
export JWT_SECRET FERNET_KEY POSTGRES_PASSWORD
export BACKEND_IMAGE="$ACR_LOGIN_SERVER/reflex-backend:latest"
export GATEWAY_IMAGE="$ACR_LOGIN_SERVER/reflex-gateway:latest"
export FRONTEND_IMAGE="$ACR_LOGIN_SERVER/reflex-frontend:latest"

az containerapp compose create \
  --resource-group "$RG" \
  --environment "$ENV_NAME" \
  --compose-file-path "$COMPOSE_FILE" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-username "$(az acr credential show --name "$ACR_NAME" --resource-group "$RG" --query username -o tsv)" \
  --registry-password "$(az acr credential show --name "$ACR_NAME" --resource-group "$RG" --query passwords[0].value -o tsv)"

echo ""
echo "✅ Deploy complete."
echo "   Backend:  https://backend.<env>.azurecontainerapps.io"
echo "   Gateway:  https://gateway.<env>.azurecontainerapps.io"
echo "   Frontend: https://frontend.<env>.azurecontainerapps.io"
echo ""
echo "   Save these secrets (they won't be shown again):"
echo "   JWT_SECRET=$JWT_SECRET"
echo "   FERNET_KEY=$FERNET_KEY"
echo "   POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
