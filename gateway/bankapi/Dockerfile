FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init bankapi && \
    go get github.com/modelcontextprotocol/go-sdk && \
    go mod tidy && \
    CGO_ENABLED=0 go build -o /bankapi .

FROM alpine:3.21
COPY --from=builder /bankapi /bankapi
EXPOSE 9000
ENTRYPOINT ["/bankapi"]
