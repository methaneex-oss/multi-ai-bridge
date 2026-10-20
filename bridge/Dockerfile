FROM golang:1.22-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /bridge .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /bridge /app/bridge
RUN mkdir -p /data
EXPOSE 8080
CMD ["/app/bridge"]
