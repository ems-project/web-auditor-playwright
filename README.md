# Web-Auditor (with Playwright)

## TL;DR

```shell
npm install
npm run build
START_URL=https://mathieu.dekeyzer.net npm start
```

## Build & run

```shell
docker build -t elasticms/web-auditor .

docker run --rm \
  -v $(pwd)/reports:/opt/reports \
  -e START_URL="https://your-site.com" \
  -e WEBSITE_ID="your_site" \
  -e MAX_PAGES="80" \
  -e MAX_DEPTH="15" \
  -e CONCURRENCY="2" \
  -e RATE_LIMIT_MS="500" \
  -e CHECK_EXTERNAL_LINKS="false" \
  elasticms/web-auditor
```

## Environment Variables

The crawler can be configured using environment variables.  
These variables control crawl behavior, performance limits, and execution parameters.

You can define them directly in the shell, in a `.env` file, or via Docker environment variables.

Example:

```bash
START_URL=https://your-site.com \
MAX_PAGES=100 \
CONCURRENCY=3 \
RATE_LIMIT_MS=500 \
npm start
```

| Variable                                    | Default                                                          | Description                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `START_URL`                                 | `https://example.org`                                            | The initial URL where the crawler starts. All discovered pages will be crawled starting from this entry point.                                                                                                                                                          |
| `WEBSITE_ID`                                | `my_website`                                                     | Used to saved the report in the `REPORT_OUTPUT_DIR` directory.                                                                                                                                                                                                          |
| `MAX_PAGES`                                 | `50`                                                             | Maximum number of pages the crawler will visit before stopping.                                                                                                                                                                                                         |
| `MAX_DEPTH`                                 | `3`                                                              | Maximum crawl depth starting from the `START_URL`. Depth `0` is the start page.                                                                                                                                                                                         |
| `CONCURRENCY`                               | `3`                                                              | Maximum number of pages processed in parallel. Increasing this value speeds up crawling but increases CPU and memory usage.                                                                                                                                             |
| `USER_AGENT`                                | `undefined`                                                      | If defined, it will overwrite the Playright's user agent .                                                                                                                                                                                                              |
| `RATE_LIMIT_MS`                             | `500`                                                            | Minimum delay (in milliseconds) between navigation requests. This helps avoid overloading the target server.                                                                                                                                                            |
| `NAV_TIMEOUT_MS`                            | `30000`                                                          | Maximum time (in milliseconds) allowed for page navigation before it is considered a failure.                                                                                                                                                                           |
| `SAME_ORIGIN_ONLY`                          | `true`                                                           | If enabled, the crawler only follows links that belong to the same origin as the `START_URL`.                                                                                                                                                                           |
| `CHECK_EXTERNAL_LINKS`                      | `false`                                                          | If enabled, dead link detection will also test external links. Otherwise only internal links are checked.                                                                                                                                                               |
| `LH_EVERY_N`                                | `10`                                                             | Run a Lighthouse audit every N HTML pages visited.                                                                                                                                                                                                                      |
| `REPORT_OUTPUT_DIR`                         | `./reports` (`/opt/reports` in the docker image)                 | Path to the directory used to store URL reports (one JSON file per URL).                                                                                                                                                                                                |
| `OUTPUT_FORMAT`                             | `table`                                                          | Controls output format of the crawler results (`json`, `table`, `both` or `none`).                                                                                                                                                                                      |
| `A11Y_AXE_RELEVANT_TAGS`                    | `EN-301-549`                                                     | Comma-separated list of Axe rule tags to include in accessibility results filtering (e.g. `wcag2a,wcag2aa`).                                                                                                                                                            |
| `DOWNLOAD_OUTPUT_DIR`                       | `./downloads` (`/opt/downloads` in the docker image) `           | Directory where downloaded files are temporarily stored during analysis.                                                                                                                                                                                                |
| `DOWNLOAD_KEEP_FILES`                       | `false`                                                          | If set to `true`, keeps downloaded files on disk instead of deleting them after processing.                                                                                                                                                                             |
| `DOWNLOAD_MAX_EXTRACTED_CHARS`              | `200000`                                                         | Maximum number of characters extracted from a downloaded resource's content.                                                                                                                                                                                            |
| `DOWNLOAD_MAX_PDF_PAGES`                    | `200`                                                            | Maximum number of PDF pages to parse when extracting text from downloaded PDF resources.                                                                                                                                                                                |
| `DOWNLOAD_MAX_LINKS`                        | `500`                                                            | Maximum number of links extracted from a downloaded resource.                                                                                                                                                                                                           |
| `DOWNLOAD_MAX_TEXT_READ_BYTES`              | `5.242.880`                                                      | Maximum file size (in bytes) allowed for text-based extraction from downloaded resources.                                                                                                                                                                               |
| `DOWNLOAD_MAX_BINARY_READ_BYTES`            | `20.971.520`                                                     | Maximum file size (in bytes) allowed for binary document extraction from downloaded resources.                                                                                                                                                                          |
| `DOWNLOAD_ENABLE_TEXTRACT_FALLBACK`         | `true`                                                           | Textract is used only as an optional fallback extractor for unsupported downloaded document formats.<br/>Its dependency tree may trigger npm audit warnings; do not downgrade it automatically with `npm audit fix --force` without validating extractor compatibility. |
| `LANGUAGE_DETECTION_MIN_LENGTH`             | `100`                                                            | Minimum number of content characters required before attempting language detection.                                                                                                                                                                                     |
| `LANGUAGE_DETECTION_MAX_SAMPLE_LENGTH`      | `5000`                                                           | Maximum number of content characters sampled for language detection.                                                                                                                                                                                                    |
| `LANGUAGE_DETECTION_OVERWRITE`              | `false`                                                          | If set to `true`, replaces an existing detected or declared locale with the automatically detected one.                                                                                                                                                                 |
| `CONSOLE_AUDIT_ONLY_START_URL`              | `false`                                                          | If set to `true`, console messages are collected only on the start URL instead of on all crawled pages.                                                                                                                                                                 |
| `CONSOLE_INCLUDE_WARNINGS`                  | `true`                                                           | If set to `false`, console warnings are ignored and only errors are reported.                                                                                                                                                                                           |
| `CONSOLE_IGNORED_PATTERNS`                  | `favicon\.ico,chrome-extension:\/\/,Failed to load resource: .*` | Comma-separated list of regex patterns used to ignore specific console messages.                                                                                                                                                                                        |
| `PDF_A11Y_MIN_EXTRACTED_CHARS`              | `30`                                                             | Minimum number of extracted characters required before considering that a PDF contains usable text.                                                                                                                                                                     |
| `PDF_A11Y_MAX_PAGES`                        | `200`                                                            | Maximum number of PDF pages analyzed during accessibility heuristics.                                                                                                                                                                                                   |
| `PDF_A11Y_LOW_TEXT_THRESHOLD`               | `20`                                                             | Average number of extracted characters per page below which a PDF is considered likely scanned or image-only.                                                                                                                                                           |
| `PDF_A11Y_WARN_MISSING_BOOKMARKS_MIN_PAGES` | `5`                                                              | Minimum number of pages from which missing PDF bookmarks are reported as a warning.                                                                                                                                                                                     |
| `PERF_AUDIT_ONLY_START_URL`                 | `false`                                                          | If set to `true`, collects performance metrics only for the start URL instead of all crawled pages.                                                                                                                                                                     |
| `PERF_SLOW_RESOURCE_THRESHOLD_MS`           | `1000`                                                           | Minimum resource duration in milliseconds before a resource is reported as slow.                                                                                                                                                                                        |
| `PERF_LARGE_RESOURCE_THRESHOLD_BYTES`       | `500000`                                                         | Minimum resource transfer size in bytes before a resource is reported as large.                                                                                                                                                                                         |
| `PERF_MAX_REPORTED_RESOURCES`               | `10`                                                             | Maximum number of slowest and largest resources included in the report.                                                                                                                                                                                                 |
| `PERF_HIGH_RESOURCE_COUNT_THRESHOLD`        | `100`                                                            | Number of loaded resources above which the page is reported as resource-heavy.                                                                                                                                                                                          |
| `PERF_LARGE_TRANSFER_THRESHOLD_BYTES`       | `3000000`                                                        | Total transferred bytes threshold above which the page is reported as heavy.                                                                                                                                                                                            |
| `PERF_SLOW_LOAD_THRESHOLD_MS`               | `3000`                                                           | Load event threshold in milliseconds above which the page is reported as slow.                                                                                                                                                                                          |
| `PERF_SLOW_DOMCONTENTLOADED_THRESHOLD_MS`   | `1500`                                                           | DOMContentLoaded threshold in milliseconds above which the page is reported as slow.                                                                                                                                                                                    |

## Performance Tuning

These parameters are the most important for controlling crawler performance:

### Concurrency

`CONCURRENCY` controls how many pages are processed simultaneously.

Typical values:

| Value | Use Case                                             |
| ----- | ---------------------------------------------------- |
| `1`   | Debugging                                            |
| `2-3` | Safe crawling                                        |
| `5`   | Faster crawl                                         |
| `10+` | High-performance crawling (requires strong hardware) |

### Rate Limiting

`RATE_LIMIT_MS` defines the minimum delay between navigation requests.

Examples:

| Value  | Behavior          |
| ------ | ----------------- |
| `0`    | No rate limiting  |
| `200`  | Fast crawl        |
| `500`  | Balanced          |
| `1000` | Very polite crawl |

## Code Formatting and Linting

This project uses **Prettier** for automatic code formatting and **ESLint** for static code analysis.  
Together, they ensure a consistent code style and help detect potential issues early during development.

- **Prettier** → handles formatting (indentation, quotes, line length, etc.)
- **ESLint** → enforces coding best practices and detects problematic patterns

Both tools are configured to work together without conflicts.

### Format the Entire Project

To format all files:

```bash
npm run format
```

### Check Formatting

To verify that files follow the formatting rules (useful in CI pipelines):

```bash
npm run format:check
```

If formatting issues are found, run npm run format to automatically fix them.

### Run the Linter

To analyze the project:

```bash
npm run lint
```

### Automatically Fix Issues

Some issues can be fixed automatically:

```bash
npm run lint:fix
```
