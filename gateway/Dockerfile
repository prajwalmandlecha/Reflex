FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build gateway and goose
COPY . .
RUN CGO_ENABLED=0 go build -o /gateway ./cmd/gateway
RUN CGO_ENABLED=0 go install github.com/pressly/goose/v3/cmd/goose@latest

# Runtime
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /gateway /gateway
COPY --from=builder /go/bin/goose /usr/local/bin/goose
COPY --from=builder /app/migrations /migrations

EXPOSE 8080 9090

ENTRYPOINT ["/gateway"]
