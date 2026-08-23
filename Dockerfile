# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN pnpm --filter @legends/api exec prisma generate
RUN pnpm --filter @legends/api build
RUN pnpm --filter @legends/web build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates nginx \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY --from=build /app/packages/shared ./packages/shared
COPY nginx/default.conf /etc/nginx/sites-available/default
COPY docker/start-container.sh /usr/local/bin/start-container.sh

RUN mkdir -p /app/storage/highlights
RUN chmod +x /usr/local/bin/start-container.sh

EXPOSE 80
EXPOSE 3333

CMD ["/usr/local/bin/start-container.sh"]
