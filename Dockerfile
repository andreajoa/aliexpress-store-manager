# syntax=docker/dockerfile:1
# NexaCloud build (GitHub Actions). Production variables arrive as the build secret "ncenv"
# (needed because `npm run build` runs `prisma migrate deploy` against the database).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true NEXT_TELEMETRY_DISABLED=1
COPY . .
ARG NC_ENV_HASH
RUN --mount=type=secret,id=ncenv sh -c 'set -a; [ -f /run/secrets/ncenv ] && . /run/secrets/ncenv; set +a; npm ci && npm run build'
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
