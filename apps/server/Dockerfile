FROM oven/bun:1

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install

COPY apps/server apps/server
COPY packages/shared packages/shared

RUN mkdir -p /app/apps/server/data \
  && chown -R bun:bun /app

EXPOSE 3000

USER bun

CMD ["bun", "run", "start"]
