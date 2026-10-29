# 统一Node与pnpm版本，构建阶段不复制任何真实环境文件。
FROM node:22.20.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @journey/contracts build && pnpm --filter @journey/api build
# PostgreSQL客户端支持真实备份/恢复；镜像不内置数据库密码。
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg ca-certificates && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STORAGE_ENABLED=true CHAT_EXECUTOR=agent ENABLE_DIAGNOSTICS=false
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
