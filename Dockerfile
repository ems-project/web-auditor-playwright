# syntax=docker/dockerfile:1.15
FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS builder

WORKDIR /app

# Dependencies
COPY package.json tsconfig.json ./

# Sources
COPY src ./src

RUN mkdir -p /opt/reports /opt/downloads \
    && npm install \
    && npm run build \
    && chown -R pwuser:0 /opt/reports /opt/downloads /app/dist /app/node_modules \
    && chmod 775 /opt/reports /opt/downloads /app/dist /app/node_modules

FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY --from=builder --chmod=775 --chown=pwuser:0 /app/package.json /app/package.json
COPY --from=builder --chmod=775 --chown=pwuser:0 /app/node_modules /app/node_modules
COPY --from=builder --chmod=775 --chown=pwuser:0 /app/dist /app/dist
COPY --from=builder --chmod=775 --chown=pwuser:0 /opt/ /opt/

# System dependencies for OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    tesseract-ocr-nld \
    tesseract-ocr-deu \
    && rm -rf /var/lib/apt/lists/*

# Default variables
ENV REPORT_OUTPUT_DIR="/opt/reports" \
    DOWNLOAD_OUTPUT_DIR="/opt/downloads" \
    START_URL="https://example.org" \
    MAX_PAGES="50" \
    MAX_DEPTH="3" \
    CONCURRENCY="3" \
    SAME_ORIGIN_ONLY="true" \
    CHECK_EXTERNAL_LINKS="false" \
    NAV_TIMEOUT_MS="30000"

USER pwuser

CMD ["npm", "start"]
