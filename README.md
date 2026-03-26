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
- black list errors envvar

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

## Finding codes by plugin

### Content / SEO / HTML

| Plugin             | Code                       | Description              | Profiles        | Recommended Actions |
| ------------------ | -------------------------- | ------------------------ | --------------- | ------------------- |
| language-detection | LANGUAGE_UNDETERMINED      | Language not detected    | Copywriter      | Define lang         |
| language-detection | LANGUAGE_DETECTION_SKIPPED | Detection skipped        | Integrator      | Adjust config       |
| html-processor     | LOW_CONTENT                | Not enough content       | Copywriter      | Add content         |
| html-processor     | MAIL_OR_TEL_LINK           | mailto/tel link detected | Webmaster       | Validate usage      |
| html-processor     | TITLE_MISSING              | Missing title            | SEO, Copywriter | Add title           |
| html-processor     | TITLE_TOO_SHORT            | Too short                | SEO             | Improve             |
| html-processor     | TITLE_TOO_LONG             | Too long                 | SEO             | Shorten             |
| html-processor     | TITLE_BRAND_TOO_LONG       | Brand too long           | SEO             | Reduce              |
| html-processor     | TITLE_BRAND_DUPLICATED     | Brand duplicated         | SEO             | Fix                 |
| html-processor     | TITLE_MAIN_TOO_SHORT       | Main part too short      | SEO             | Improve             |
| html-processor     | TITLE_TOO_MANY_PARTS       | Too many segments        | SEO             | Simplify            |

### URL / Crawl

| Plugin              | Code                      | Description           | Profiles       | Recommended Actions |
| ------------------- | ------------------------- | --------------------- | -------------- | ------------------- |
| html-processor      | MISSING_URL               | URL missing           | Integrator     | Fix                 |
| html-processor      | EMPTY_URL                 | Empty URL             | Integrator     | Fix                 |
| html-processor      | NOT_PARSABLE_URL          | Invalid URL           | Integrator     | Fix                 |
| standard-urls-audit | STANDARD_URL_NOT_ENQUEUED | Canonical not crawled | Integrator     | Fix crawler         |
| standard-urls-audit | STANDARD_URL_MISSING      | Canonical URL missing | Webmaster, SEO | Add canonical link  |

### HTML Accessibility

Lowercase finding codes (e.g. `area-alt` or `scrollable-region-focusable`) correspond to accessibility rules detected by the a11y-axe plugin.
These codes match Axe’s Rule IDs (as defined by Deque Systems) and indicate specific accessibility issues identified during the audit.
Each rule represents a known accessibility requirement based on standards such as WCAG.
You can find detailed explanations, examples, and remediation guidance for each rule on the [official Axe documentation website](https://dequeuniversity.com/rules/axe/4.11).

### Content extraction

| Plugin                                        | Code                                  | Description                         | Profiles               | Recommended Actions         |
| --------------------------------------------- | ------------------------------------- | ----------------------------------- | ---------------------- | --------------------------- |
| pdf-extractor, docx-extractor, text-extractor | TEXT_EXTRACTION_FAILED                | Text extraction failed              | Integrator             | Check parser / dependencies |
| text-extractor                                | TEXT_EXTRACTION_SKIPPED_TOO_LARGE     | Extraction skipped due to size      | Infra                  | Same as above               |
| pdf-extractor                                 | PDF_EXTRACTION_FAILED                 | Extraction failed                   | Integrator             | Check PDF                   |
| pdf-extractor                                 | PDF_EMPTY_TEXT                        | Empty text                          | Copywriter             | Fix content                 |
| pdf-extractor                                 | PDF_NO_TEXT                           | No extractable text                 | Integrator             | Use OCR                     |
| pdf-extractor                                 | PDF_EXTRACTION_SKIPPED_TOO_LARGE      | Too large                           | Infra                  | Adjust limits               |
| docx-extractor                                | DOCX_EXTRACTION_SKIPPED_TOO_LARGE     | Too large DOCX                      | Infra                  | Adjust limits               |
| textract-extractor                            | TEXTRACT_NO_CONTENT                   | No content extracted                | Integrator, Copywriter | Verify file content         |
| textract-extractor                            | TEXTRACT_DEPENDENCY_MISSING           | Missing dependency (e.g. tesseract) | Infra                  | Install dependencies        |
| textract-extractor                            | TEXTRACT_EXTRACTION_SKIPPED_TOO_LARGE | File too large to process           | Infra                  | Increase limits or skip     |

### PDF Accessibility

| Plugin            | Code                                  | Description       | Profiles   | Recommended Actions |
| ----------------- | ------------------------------------- | ----------------- | ---------- | ------------------- |
| pdf-accessibility | PDF_ACCESSIBILITY_AUDIT_FAILED        | Audit failed      | Integrator | Debug               |
| pdf-accessibility | PDF_ACCESSIBILITY_NOT_TAGGED          | Not tagged        | Integrator | Add tags            |
| pdf-accessibility | PDF_ACCESSIBILITY_LINKS_NOT_DETECTED  | Links missing     | Integrator | Add links           |
| pdf-accessibility | PDF_ACCESSIBILITY_BOOKMARKS_MISSING   | Missing bookmarks | Integrator | Add bookmarks       |
| pdf-accessibility | PDF_ACCESSIBILITY_PROBABLY_SCANNED    | Likely scanned    | Integrator | OCR                 |
| pdf-accessibility | PDF_ACCESSIBILITY_NO_EXTRACTABLE_TEXT | No text           | Integrator | OCR                 |
| pdf-accessibility | PDF_ACCESSIBILITY_LANGUAGE_MISSING    | Language missing  | Integrator | Add metadata        |
| pdf-accessibility | PDF_ACCESSIBILITY_TITLE_MISSING       | Title missing     | Integrator | Add title           |

### Download / Files

| Plugin           | Code                           | Description       | Profiles   | Recommended Actions |
| ---------------- | ------------------------------ | ----------------- | ---------- | ------------------- |
| downloader       | MIME_UNKNOWN                   | Unknown MIME type | Integrator | Fix headers         |
| downloader       | DOWNLOAD_FAILED                | Download failed   | Integrator | Fix URL/server      |
| clean-downloaded | DOWNLOADED_FILE_CLEANUP_FAILED | Cleanup failed    | Infra      | Fix FS rights       |

### Console

| Plugin  | Code                      | Description      | Profiles   | Recommended Actions |
| ------- | ------------------------- | ---------------- | ---------- | ------------------- |
| console | CONSOLE_WARNINGS_DETECTED | Console warnings | Integrator | Fix warnings        |
| console | CONSOLE_ERRORS_DETECTED   | Console errors   | Integrator | Fix errors          |

### Security Headers

| Plugin           | Code                                | Description                          | Profiles   | Recommended Actions |
| ---------------- | ----------------------------------- | ------------------------------------ | ---------- | ------------------- |
| security-headers | SECURITY_HEADERS_SCORE              | Global score                         | Infra      | Improve headers     |
| security-headers | COOKIE_SAMESITE_NONE_WITHOUT_SECURE | SameSite=None without Secure         | Integrator | Add Secure flag     |
| security-headers | COOKIE_INVALID_SAMESITE             | Invalid SameSite value               | Integrator | Fix attribute       |
| security-headers | COOKIE_MISSING_SAMESITE             | Missing SameSite                     | Integrator | Add SameSite        |
| security-headers | COOKIE_MISSING_HTTPONLY             | Missing HttpOnly                     | Integrator | Add HttpOnly        |
| security-headers | COOKIE_MISSING_SECURE               | Missing Secure flag                  | Integrator | Add Secure          |
| security-headers | MISSING_CORP                        | Missing Cross-Origin-Resource-Policy | Infra      | Add header          |
| security-headers | MISSING_COOP                        | Missing Cross-Origin-Opener-Policy   | Infra      | Add header          |
| security-headers | MISSING_PERMISSIONS_POLICY          | Missing Permissions-Policy           | Infra      | Define policy       |
| security-headers | WEAK_REFERRER_POLICY                | Weak policy                          | Infra      | Use strict policy   |
| security-headers | INVALID_REFERRER_POLICY             | Invalid value                        | Infra      | Fix value           |
| security-headers | MISSING_REFERRER_POLICY             | Missing header                       | Infra      | Add header          |
| security-headers | INVALID_X_CONTENT_TYPE_OPTIONS      | Invalid header                       | Infra      | Fix                 |
| security-headers | MISSING_X_CONTENT_TYPE_OPTIONS      | Missing header                       | Infra      | Add nosniff         |
| security-headers | WEAK_X_FRAME_OPTIONS                | Weak protection                      | Infra      | Use DENY/SAMEORIGIN |
| security-headers | MISSING_CLICKJACKING_PROTECTION     | Missing XFO/CSP                      | Infra      | Add protection      |
| security-headers | MISSING_CSP                         | No Content-Security-Policy           | Infra      | Define CSP          |
| security-headers | CSP_REPORT_ONLY_ONLY                | CSP report-only only                 | Infra      | Enforce CSP         |
| security-headers | WEAK_CSP                            | Weak CSP rules                       | Infra      | Harden CSP          |
| security-headers | MISSING_HSTS                        | Missing HSTS                         | Infra      | Add HSTS            |
| security-headers | WEAK_HSTS_MAX_AGE                   | Low max-age                          | Infra      | Increase duration   |
| security-headers | INVALID_HSTS                        | Invalid config                       | Infra      | Fix                 |
| security-headers | HSTS_NOT_APPLICABLE                 | Not applicable                       | Infra      | None                |
| security-headers | SECURITY_HEADERS_NOT_AUDITED        | Not audited                          | Infra      | Ensure audit runs   |

### TLS/Certificate

| Plugin          | Code                            | Description                                  | Profiles         | Recommended Actions                               |
| --------------- | ------------------------------- | -------------------------------------------- | ---------------- | ------------------------------------------------- |
| tls-certificate | TLS_CERTIFICATE_SHORT_CHAIN     | Certificate chain is incomplete or too short | Infra, Webmaster | Fix certificate chain, include intermediate certs |
| tls-certificate | TLS_CERTIFICATE_WEAK_CIPHER     | Weak cipher suites detected                  | Infra            | Disable weak ciphers, enforce modern TLS          |
| tls-certificate | TLS_CERTIFICATE_OLD_TLS_VERSION | Deprecated TLS version used                  | Infra            | Enforce TLS 1.2+ or 1.3                           |
| tls-certificate | TLS_CERTIFICATE_NO_SAN          | Missing Subject Alternative Name             | Infra            | Regenerate certificate with SAN                   |
| tls-certificate | TLS_CERTIFICATE_SELF_SIGNED     | Self-signed certificate                      | Infra            | Use trusted CA                                    |
| tls-certificate | TLS_CERTIFICATE_EXPIRING_SOON   | Certificate close to expiration              | Infra            | Renew certificate                                 |
| tls-certificate | TLS_CERTIFICATE_EXPIRED         | Certificate expired                          | Infra            | Renew immediately                                 |
| tls-certificate | TLS_CERTIFICATE_INVALID         | Invalid certificate                          | Infra            | Fix certificate configuration                     |
| tls-certificate | TLS_CERTIFICATE_SCORE           | Overall TLS quality score                    | Infra            | Improve configuration                             |
| tls-certificate | TLS_CERTIFICATE_AUDIT_FAILED    | TLS audit failed                             | Infra            | Check connectivity / TLS setup                    |
| tls-certificate | TLS_CERTIFICATE_DETAILS         | Informational certificate details            | Infra            | Review configuration                              |
| tls-certificate | TLS_CERTIFICATE_NOT_APPLICABLE  | TLS not applicable                           | Infra            | Install a certificate                             |
| tls-certificate | TLS_CERTIFICATE_INVALID_URL     | Invalid URL for TLS check                    | Webmaster        | Fix URL                                           |
| tls-certificate | TLS_CERTIFICATE_NOT_AUDITED     | TLS not audited                              | Infra            | Ensure audit runs                                 |

### Network / IP

| Plugin     | Code                   | Description        | Profiles  | Recommended Actions |
| ---------- | ---------------------- | ------------------ | --------- | ------------------- |
| ip-support | IPV6_UNREACHABLE       | IPv6 not reachable | Infra     | Fix network         |
| ip-support | IPV4_UNREACHABLE       | IPv4 not reachable | Infra     | Fix network         |
| ip-support | IPV6_MISSING           | No IPv6 support    | Infra     | Add IPv6            |
| ip-support | IPV4_MISSING           | No IPv4            | Infra     | Add IPv4            |
| ip-support | IP_SUPPORT_DETAILS     | Info               | Infra     | Review              |
| ip-support | IP_SUPPORT_INVALID_URL | Invalid URL        | Webmaster | Fix                 |
| ip-support | IP_SUPPORT_NOT_AUDITED | Not audited        | Infra     | Enable audit        |

### Performances

| Plugin              | Code                      | Description         | Profiles   | Recommended Actions    |
| ------------------- | ------------------------- | ------------------- | ---------- | ---------------------- |
| performance-metrics | LARGE_RESOURCES_DETECTED  | Large assets        | Integrator | Optimize images/assets |
| performance-metrics | SLOW_RESOURCES_DETECTED   | Slow resources      | Integrator | Optimize loading       |
| performance-metrics | FAILED_RESOURCES_DETECTED | Failed requests     | Integrator | Fix broken resources   |
| performance-metrics | LARGE_TOTAL_TRANSFER_SIZE | Page too heavy      | Integrator | Reduce weight          |
| performance-metrics | HIGH_RESOURCE_COUNT       | Too many requests   | Integrator | Bundle/minify          |
| performance-metrics | SLOW_PAGE_LOAD            | Slow load time      | Integrator | Optimize performance   |
| performance-metrics | SLOW_DOM_CONTENT_LOADED   | Slow DOM ready      | Integrator | Optimize scripts       |
| performance-metrics | PERFORMANCE_MEASURED      | Performance metrics | Integrator | Analyze                |

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
