FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# System dependencies for OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    && rm -rf /var/lib/apt/lists/*

# Create reports and downloads directories with correct permissions
RUN mkdir -p /opt/reports && chown -R pwuser:pwuser /opt/reports && mkdir -p /opt/downloads && chown -R pwuser:pwuser /opt/downloads

# Dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Sources
COPY src ./src
RUN npm run build

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

CMD ["npm", "start"]