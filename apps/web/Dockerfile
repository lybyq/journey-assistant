# 网页静态构建只接收公开Vite配置，后端Key不进入镜像构建参数。
FROM node:22.20.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @journey/contracts build && pnpm --filter @journey/web build
# API通过同域反向代理，访问凭据不会暴露在URL中。
FROM nginx:stable-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
