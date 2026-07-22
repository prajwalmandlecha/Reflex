FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 go build -o /gateway ./cmd/gateway

# Runtime
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /gateway /gateway

EXPOSE 8080 9090

ENTRYPOINT ["/gateway"]
