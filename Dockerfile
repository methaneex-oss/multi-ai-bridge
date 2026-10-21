# Bridge Core API — pure Go (no CGO) for reliable builds on Render/Railway/Fly
FROM golang:1.22-alpine AS builder

WORKDIR /src
RUN apk add --no-cache git ca-certificates

COPY bridge/go.mod ./
RUN go mod download || true
COPY bridge/ ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bridge .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /bridge /app/bridge
RUN mkdir -p /data
ENV BRIDGE_PORT=8080
ENV DATABASE_PATH=/data/bridge.db
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["/app/bridge"]
