FROM node:24-bookworm-slim AS agent-build
WORKDIR /build/agent-runtime
COPY agent-runtime/package*.json ./
RUN npm ci
COPY agent-runtime/tsconfig.json ./
COPY agent-runtime/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS agent
ENV NODE_ENV=production GLAUX_EDITION=chat GLAUX_AGENT_HOST=0.0.0.0 GLAUX_AGENT_DATA_DIR=/data
WORKDIR /app/agent-runtime
COPY --from=agent-build /build/agent-runtime/package.json ./
COPY --from=agent-build /build/agent-runtime/node_modules ./node_modules
COPY --from=agent-build /build/agent-runtime/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8010
CMD ["node", "dist/index.js"]

FROM node:24-bookworm-slim AS web-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_GLAUX_EDITION=chat
RUN npm run build

FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /build/frontend/dist /usr/share/nginx/html
EXPOSE 8080
