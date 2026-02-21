FROM oven/bun:1

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "run", "start"]

