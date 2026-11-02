# Local-first image: dashboard is baked in, config + memory ride on a volume.
# Run: docker build -t tribunal . && docker run -p 3236:3236 -v tribunal-data:/data tribunal

FROM node:22-alpine AS dashboard
WORKDIR /build
COPY web/frontend/package.json web/frontend/package-lock.json ./web/frontend/
RUN cd web/frontend && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web/frontend && npm run build
RUN sh web/build.sh

FROM golang:1.22-alpine AS server
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=dashboard /build/web/dashboard ./web/dashboard
COPY --from=dashboard /build/web/overlay ./web/overlay
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/StreamTribunal ./cmd/server

FROM alpine:3.20
RUN adduser -D -h /app tribunal
WORKDIR /app
COPY --from=server /out/StreamTribunal ./StreamTribunal
COPY config.default.yaml ./config.yaml
COPY README.md LICENSE ./
RUN chown -R tribunal:tribunal /app
USER tribunal
VOLUME ["/app/data"]
EXPOSE 3236
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3236/api/status || exit 1
ENTRYPOINT ["./StreamTribunal"]
