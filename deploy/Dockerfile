FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY backend ./backend
COPY scripts ./scripts
RUN npm run typecheck && npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/qa-atlas.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir /data /backups && chown node:node /data /backups
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY scripts ./scripts
COPY examples ./examples
USER node
EXPOSE 8080
CMD ["node","backend/src/index.mjs"]
