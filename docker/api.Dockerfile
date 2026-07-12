FROM node:24.12.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @hangban/api build && pnpm --filter @hangban/ingestor build

FROM node:24.12.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate \
  && groupadd --gid 10001 hangban \
  && useradd --uid 10001 --gid 10001 --create-home hangban
COPY --from=build --chown=10001:10001 /app /app
USER hangban
CMD ["pnpm", "--filter", "@hangban/api", "start"]
