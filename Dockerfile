# Default image = Bridge Core (Go API + WebSocket)
# Used by platforms that expect ./Dockerfile at repo root (e.g. Render)

FROM golang:1.22-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /src
COPY bridge/go.mod ./
RUN go mod download
COPY bridge/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -o /bridge .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /bridge /app/bridge
RUN mkdir -p /data
ENV BRIDGE_PORT=8080
ENV DATABASE_PATH=/data/bridge.db
EXPOSE 8080
CMD ["/app/bridge"]
