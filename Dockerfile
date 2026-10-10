# Local-first image: dashboard is baked in, config + memory ride on a volume.
# Run: docker build -t tribunal . && docker run -p 7890:7890 -v tribunal-data:/data tribunal

FROM node:22-alpine AS dashboard
WORKDIR /build
COPY web/frontend/package.json web/frontend/package-lock.json ./web/frontend/
RUN cd web/frontend && npm ci --no-audit --no-fund
COPY web/frontend ./web/frontend
RUN cd web/frontend && npm run build

FROM golang:1.22-alpine AS server
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=dashboard /build/web/frontend/dist ./web/dashboard
RUN sh web/build.sh
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/StreamTribunal ./cmd/server

FROM alpine:3.20
WORKDIR /app
COPY --from=server /out/StreamTribunal ./StreamTribunal
COPY config.default.yaml ./config.yaml
COPY README.md LICENSE ./
VOLUME ["/app/data"]
EXPOSE 7890
ENTRYPOINT ["./StreamTribunal"]
