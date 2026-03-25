# Web Auditor (Playwright)

Web Auditor is an open-source website auditing tool designed to analyze and improve the quality of informational websites.

Built on top of Playwright, it crawls websites and runs a series of customizable plugins to detect issues across multiple domains such as accessibility, SEO, performance, and best practices.

## Features

- Website crawling with configurable depth and scope
- Plugin-based architecture for extensibility
- Accessibility audits (axe, etc.)
- SEO checks (titles, meta tags, structure)
- Performance insights (Lighthouse-like audits)
- Security checks (SSL, headers, certificates)
- Media analysis (images size, metadata, etc.)
- Resource analysis (PDF, downloads, MIME types)
- Structured JSON reports (one per URL)

## Plugin System

Web Auditor is built around a flexible plugin system. Each plugin can:

- Analyze pages or resources
- Emit findings categorized (SEO, A11y, Security, etc.)
- Be enabled/disabled via configuration

## Configuration

The tool can be configured using [environment variables](#environment-variables):

- URL allowlists / blocklists (regex)
- Plugin activation control
- Output directory
- Crawl limits

## Use Cases

- Audit institutional or public service websites
- Continuous quality monitoring
- Pre-production validation
- Technical SEO and accessibility reviews

## Tech Stack

- TypeScript / Node.js
- Playwright
- Optional integrations: axe-core, pa11y, trextract

## Roadmap

- Enhanced reporting (aggregated dashboards)
- CI/CD integration
- Scheduling and automation
- Advanced performance audits
- PDF accessibility checks
- Web server to follow the audit and its report
- Lighthouse plugin every x pages
- Generate a HTML report with
    - Audit summary
    - Performance report
    - European compatible accessibility report in french, dutch, german and english
- Generate a sitemap.xml report
- Validate sitemap resources
- Validate robots.txt
    - Ensure that the robots.txt has a rule to throttle the robots
    - Ensure that all page's CSS are not blocked by robots.txt's rules
- Images metadata plugin
- Images integration in HTML pages plugin
    - Non optimized images
    - Lazy loading
- Empty anchor links
- Log link's targets
- Logs external dependencies
- Cookie plugin
    - lifetime
- Language mismatched
- Stats by locales
- Extends the IPlugin by a conclusion method
- Tests runner's IPs like https://ipv4.icanhazip.com/ and https://ipv6.icanhazip.com/
- hreflang
- Soft 404
- Analyse text's complexity (something like [Scolarius](https://www.scolarius.com/))
- JSON-LD structure
    - `@context": "https://schema.org"`
- Check the format validity of email et tel links

## Installing Playwright and launch an audit locally

To use Web Auditor locally, you first need to install Playwright and its required browsers. After cloning the repository, install the project dependencies using:

```bash
npm install
```

Then, install Playwright along with the supported browsers:

```bash
npx playwright install
```

This command downloads the necessary browser binaries (Chromium, Firefox, and WebKit). If you are running the project in a restricted environment (e.g., corporate network or Docker), make sure all required system dependencies are available. For Linux environments, you may need to run:

```shell
npx playwright install-deps
```

Once completed, Playwright is ready to use and the Web Auditor can start crawling and auditing websites.

```shell
START_URL=htttps://your-site.com RATE_LIMIT_MS=400 WEBSITE_ID=your_site npm start
```

Press `s` to gracefully stop the audit and generate the report.

## Build & run a docker image locally

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
| `USER_AGENT`                                | `undefined`                                                      | If defined, it will overwrite the Playright's user agent.                                                                                                                                                                                                               |
| `IGNORE_HTTPS_ERRORS`                       | `false`                                                          | If set to true, Playwright ignores HTTPS certificate errors (e.g. self-signed or invalid certificates).                                                                                                                                                                 |
| `DISABLED_PLUGINS`                          | empty                                                            | Comma-separated list of plugin names that must not be registered or executed. E.g. `ip-support,tls-certificate`.                                                                                                                                                        |
| `RATE_LIMIT_MS`                             | `500`                                                            | Minimum delay (in milliseconds) between navigation requests. This helps avoid overloading the target server.                                                                                                                                                            |
| `NAV_TIMEOUT_MS`                            | `30000`                                                          | Maximum time (in milliseconds) allowed for page navigation before it is considered a failure.                                                                                                                                                                           |
| `SAME_ORIGIN_ONLY`                          | `true`                                                           | If enabled, the crawler only follows links that belong to the same origin as the `START_URL`.                                                                                                                                                                           |
| `URL_ALLOWLIST_REGEX`                       | empty                                                            | Comma-separated list of regular expressions. If defined, only URLs matching at least one pattern will be crawled.                                                                                                                                                       |
| `URL_BLOCKLIST_REGEX`                       | empty                                                            | Comma-separated list of regular expressions. URLs matching any pattern will be excluded from crawling. Applied after allowlist.                                                                                                                                         |
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
| `TLS_CERT_AUDIT_ONLY_START_URL`             | `true`                                                           | If set to true, audits the TLS certificate only for the start URL.                                                                                                                                                                                                      |
| `TLS_CERT_WARN_IF_EXPIRES_IN_DAYS`          | `30`                                                             | Warns when the TLS certificate expires in N days or less.                                                                                                                                                                                                               |
| `TLS_CERT_TIMEOUT_MS`                       | `10000`                                                          | Maximum time in milliseconds allowed for the TLS certificate inspection.                                                                                                                                                                                                |
| `TLS_CERT_MIN_TLS_VERSION `                 | `TLSv1.2`                                                        | Minimum accepted negotiated TLS version (TLSv1.2 or TLSv1.3).                                                                                                                                                                                                           |
| `TLS_CERT_MIN_SCORE_FOR_ERROR`              | `50`                                                             | Marks the TLS certificate score finding as an error below this score.                                                                                                                                                                                                   |
| `IP_SUPPORT_AUDIT_ONLY_START_URL`           | `true`                                                           | If set to true, audits IP support only for the start URL.                                                                                                                                                                                                               |
| `IP_SUPPORT_TIMEOUT_MS`                     | `5000`                                                           | Maximum time in milliseconds allowed for IPv4/IPv6 connectivity checks.                                                                                                                                                                                                 |
| `IP_SUPPORT_TEST_CONNECTIVITY`              | `false`                                                          | If set to true, also tests TCP connectivity over IPv4 and IPv6.                                                                                                                                                                                                         |

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

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## Code Formatting and Linting

This project uses **Prettier** for automatic code formatting and **ESLint** for static code analysis.  
Together, they ensure a consistent code style and help detect potential issues early during development.

- **Prettier** → handles formatting (indentation, quotes, line length, etc.)
- **ESLint** → enforces coding best practices and detects problematic patterns

Both tools are configured to work together without conflicts.

### TL;DR

```shell
npm run format && npm run lint:fix && npm run build
```

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

## License

LGPL-3.0
