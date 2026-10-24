FROM node:24.22.1-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force

COPY output/worker/entry.mjs ./entry.mjs
COPY output/worker/build-manifest.json ./build-manifest.json

ENV NODE_ENV=production \
    FFPROBE_PATH=/usr/bin/ffprobe \
    MODE=dispatch

USER node
ENTRYPOINT ["node", "entry.mjs"]
