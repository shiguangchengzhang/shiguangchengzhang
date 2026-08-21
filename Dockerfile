FROM node:22.17.1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    AUTH_DATA_FILE=/app/data/users.json

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js index.html ./
RUN useradd --system --uid 10001 --create-home appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app
USER appuser
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
