FROM python:3.12-slim

WORKDIR /app

# OPA CLI — used by the policy engine to validate and evaluate Rego through the
# real OPA engine (opa parse / opa eval), never a hand-rolled approximation.
# Pinned to match the embedded OPA runtime in the gateway (v1.18.2).
ARG OPA_VERSION=v1.18.2
ARG TARGETARCH=amd64
RUN set -eux; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
    curl -fsSL -o /usr/local/bin/opa "https://openpolicyagent.org/downloads/${OPA_VERSION}/opa_linux_${TARGETARCH}_static"; \
    chmod 755 /usr/local/bin/opa; \
    /usr/local/bin/opa version; \
    apt-get purge -y curl; apt-get autoremove -y; rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
