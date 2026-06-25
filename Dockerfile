FROM oven/bun:alpine AS base

WORKDIR /usr/src

RUN apk add --no-cache tzdata upx ca-certificates
RUN upx --best --lzma /usr/local/bin/bun

COPY bun.lock package.json tsconfig.json .
RUN bun install --frozen-lockfile --production

COPY src/ ./src

# build gateway
FROM base AS build-gw
RUN bun run build:gw

# build mqtt
FROM base AS build-mqtt
RUN bun run build:mqtt

# runtime
FROM scratch AS runtime

WORKDIR /app

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun
COPY --from=base /usr/lib/ /usr/lib/
COPY --from=base /lib/ /lib/

COPY --from=base /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
COPY --from=base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# gateway
FROM runtime AS gateway

COPY --from=build-gw /usr/src/dist /app

EXPOSE 3000/tcp

ENTRYPOINT ["bun", "run"]
CMD ["index.js"]

# mqtt
FROM runtime AS mqtt

COPY --from=build-mqtt /usr/src/dist /app

EXPOSE 3000/tcp

ENTRYPOINT ["bun", "run"]
CMD ["index.js"]
