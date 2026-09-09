# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS web-build

ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}

WORKDIR /src/web
COPY web/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline
COPY web/ ./
RUN npm run build

FROM golang:1.25-bookworm AS go-build

ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
  --mount=type=cache,target=/root/.cache/go-build \
  go build -trimpath -ldflags="-s -w" -o /out/javboss ./cmd/server

FROM --platform=$BUILDPLATFORM alpine:3.23 AS ffmpeg-build

ARG TARGETARCH
ARG FFMPEG_RELEASE=n8.1.2-1

RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) \
      asset_arch="x64"; \
      ffmpeg_sha256="9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee"; \
      ffprobe_sha256="065d3c56926052a76e884c4e4b51b7d95248da9391ab7effdcca6b94ceab98cf" \
      ;; \
    arm64) \
      asset_arch="arm64"; \
      ffmpeg_sha256="6e7b1d7d1aa8c35e3fedd78a140aa0968717aeb7386ecfb0ee00773d9f0a4503"; \
      ffprobe_sha256="fd2aca1456f0261cabef4514b6d97a70fa342003347f51b39c473dd364328089" \
      ;; \
    *) \
      echo "unsupported target architecture: ${TARGETARCH}" >&2; \
      exit 1 \
      ;; \
  esac; \
  release_url="https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/${FFMPEG_RELEASE}"; \
  wget -q -O /ffmpeg "${release_url}/ffmpeg-linux-${asset_arch}"; \
  echo "${ffmpeg_sha256}  /ffmpeg" | sha256sum -c -; \
  wget -q -O /ffprobe "${release_url}/ffprobe-linux-${asset_arch}"; \
  echo "${ffprobe_sha256}  /ffprobe" | sha256sum -c -; \
  chmod 0755 /ffmpeg /ffprobe

FROM gcr.io/distroless/base-debian12:latest@sha256:76b3162a31477bca4a245b836c624f4c4a1a3705e99b9003907d992bec2c4bca

WORKDIR /app
COPY --from=ffmpeg-build /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-build /ffprobe /usr/local/bin/ffprobe
COPY --from=go-build /out/javboss ./javboss
COPY --from=web-build /src/web/dist ./web/dist

ENV JAVBOSS_CONTAINER=1 \
  JAVBOSS_DISABLE_DESKTOP_INTEGRATION=1 \
  JAVBOSS_DISABLE_MPV=1 \
  JAVBOSS_USE_FFMPEG_SCREENSHOTS=1 \
  JAVBOSS_HOST_PATH_PREFIX=1 \
  JAVBOSS_PROXY_HOST_GATEWAY=1 \
  FFMPEG_PATH=/usr/local/bin/ffmpeg \
  FFPROBE_PATH=/usr/local/bin/ffprobe

EXPOSE 17654
VOLUME ["/app/data"]

CMD ["./javboss"]
