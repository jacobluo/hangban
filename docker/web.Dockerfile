FROM node:24.12.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @hangban/web build

FROM node:24.12.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --gid 10001 hangban && useradd --uid 10001 --gid 10001 --create-home hangban
COPY --from=build --chown=10001:10001 /app/apps/web/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/apps/web/.next/static ./apps/web/.next/static
USER hangban
CMD ["node", "apps/web/server.js"]
