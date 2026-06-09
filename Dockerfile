FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY knowledge ./knowledge
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WORKBENCH_HOST=0.0.0.0
ENV WORKBENCH_PORT=4173

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY knowledge ./knowledge
COPY .env.example ./

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKBENCH_PORT || '4173') + '/healthz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "dist/workbench/server.js"]
