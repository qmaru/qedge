# bun
FROM oven/bun:alpine AS base

WORKDIR /usr/src

RUN apk add --no-cache upx ca-certificates tzdata

RUN upx --best --lzma /usr/local/bin/bun

COPY bun.lock package.json tsconfig.json ./

RUN bun install --frozen-lockfile --production

COPY src ./src

# build gateway
FROM base AS build-gw

RUN bun run build:gw

# build mqtt
FROM base AS build-mqtt

RUN bun run build:mqtt

#  bun in scratch
FROM scratch AS base-runtime

WORKDIR /app

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun
COPY --from=base /usr/lib/ /usr/lib/
COPY --from=base /lib/ /lib/

COPY --from=base /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
COPY --from=base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# built-in docker in alpine
FROM alpine:3.22 AS docker-runtime

RUN apk add --no-cache \
    bash \
    libstdc++ \
    ca-certificates \
    tzdata \
    docker-cli \
    docker-cli-compose \
    upx \
 && upx --best --lzma /usr/bin/docker \
 && find /usr -type f -name docker-compose -exec upx --best --lzma {} \; \
 && apk del upx

WORKDIR /app

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

ENV TZ=Asia/Shanghai

ENTRYPOINT ["bun", "run"]

# gateway
FROM base-runtime AS gateway

COPY --from=build-gw /usr/src/dist /app

EXPOSE 3000

CMD ["index.js"]

# mqtt
FROM docker-runtime AS mqtt

COPY --from=build-mqtt /usr/src/dist /app

EXPOSE 3000

CMD ["index.js"]
