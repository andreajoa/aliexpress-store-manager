# syntax=docker/dockerfile:1
# NexaCloud build (GitHub Actions). `prisma generate && next build` runs in CI;
# `prisma migrate deploy` runs on container startup with private EC2 DB access.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true NEXT_TELEMETRY_DISABLED=1
COPY . .
ARG NC_ENV_HASH
RUN --mount=type=secret,id=ncenv sh -c 'set -a; [ -f /run/secrets/ncenv ] && . /run/secrets/ncenv; set +a; npm ci && npm run build'
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && exec npm start"]
