FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY *.ts tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/app/data/pulso.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY web ./web
USER node
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "dist/index.js", "start"]
