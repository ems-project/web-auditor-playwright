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
- Stop and resume audits

## Plugin System

Web Auditor is built around a flexible plugin system. Each plugin can:

- Analyze pages or resources
- Emit findings categorized (SEO, A11y, Security, etc.)
- Be enabled/disabled via configuration

## Configuration

The tool can be configured using [environment variables](#environment-variables):

- URL allowlists / blocklists (regex)
- Additional allowed hosts via `ALLOWED_ORIGINS`
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
- sqlite3
- Optional integrations: axe-core, pa11y, trextract, franc, exceljs, mammoth, pdfjs

## Roadmap

- Scheduling and automation
- Lighthouse plugin every x pages
- Empty anchor links
- Stats by locales
- Analyse text's complexity (something like [Scolarius](https://www.scolarius.com/))
- JSON-LD structure (`@context": "https://schema.org"`)
- Detects duplicates
- Information Architecture plugin

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

If an audit was stopped gracefully, you can resume it later with `RESUME_RUN_ID`. The crawler reloads the persisted state, resumes the queued URLs, and keeps using the same audit database.

```shell
RESUME_RUN_ID=42 WEBSITE_ID=your_site npm start
```

You can also use `RESUME_RUN_ID` to regenerate `report.json`, `report.xlsx` and `sitemap.xml` from a previous crawl stored in the same report directory. This is useful when the crawl is already complete and you want to rebuild the final artifacts from the existing database.

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

| Variable                                    | Default                                                          | Description                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `START_URL`                                 | `https://example.org`                                            | The initial URL where the crawler starts. All discovered pages will be crawled starting from this entry point.                                                                                                                                                                                                       |
| `WEBSITE_ID`                                | `my_website`                                                     | Used to saved the report in the `REPORT_OUTPUT_DIR` directory.                                                                                                                                                                                                                                                       |
| `RESUME_RUN_ID`                             | empty                                                            | If defined, resumes a previous crawl run stored in the current `REPORT_OUTPUT_DIR/WEBSITE_ID/audit.db`.<br/> It restores the persisted plugin state saved during a graceful stop, continues with queued URLs, and can also be used to regenerate `report.json`, `report.xlsx` and `sitemap.xml` from an older crawl. |
| `MAX_PAGES`                                 | `50`                                                             | Maximum number of pages the crawler will visit before stopping.                                                                                                                                                                                                                                                      |
| `MAX_DEPTH`                                 | `3`                                                              | Maximum crawl depth starting from the `START_URL`. Depth `0` is the start page.                                                                                                                                                                                                                                      |
| `WEB_UI_ENABLED`                            | `true`                                                           | Starts the local web UI server when set to `true`. Set it to `false` to disable the crawl monitor and final audit summary pages.                                                                                                                                                                                     |
| `WEB_UI_PORT`                               | `3030`                                                           | TCP port used by the local web UI server. Set to `0` to disable it implicitly.                                                                                                                                                                                                                                       |
| `WEB_UI_HOST`                               | `127.0.0.1` (`0.0.0.0` in the docker image)                      | Host interface used by the local web UI server.                                                                                                                                                                                                                                                                      |
| `CONCURRENCY`                               | `3`                                                              | Maximum number of pages processed in parallel. Increasing this value speeds up crawling but increases CPU and memory usage.                                                                                                                                                                                          |
| `USER_AGENT`                                | `undefined`                                                      | If defined, it will overwrite the Playright's user agent.                                                                                                                                                                                                                                                            |
| `IGNORE_HTTPS_ERRORS`                       | `false`                                                          | If set to true, Playwright ignores HTTPS certificate errors (e.g. self-signed or invalid certificates).                                                                                                                                                                                                              |
| `DISABLED_PLUGINS`                          | empty                                                            | Comma-separated list of plugin names that must not be registered or executed. E.g. `ip-support,tls-certificate`.                                                                                                                                                                                                     |
| `FINDING_CODES_BLOCKLIST`                   | empty                                                            | Comma-separated list of finding codes to exclude from the report; any matching findings will be ignored. E.g. `MAIL_OR_TEL_LINK,INVALID_MAILTO_HREF,INVALID_TEL_HREF`.                                                                                                                                               |
| `RATE_LIMIT_MS`                             | `500`                                                            | Minimum delay (in milliseconds) between navigation requests. This helps avoid overloading the target server.                                                                                                                                                                                                         |
| `NAV_TIMEOUT_MS`                            | `30000`                                                          | Maximum time (in milliseconds) allowed for page navigation before it is considered a failure.                                                                                                                                                                                                                        |
| `ALLOWED_ORIGINS`                           | empty                                                            | Comma-separated list of additional allowed origins or hosts that the crawler may follow. The host of `START_URL` is always allowed automatically, and every value in `ALLOWED_ORIGINS` is normalized to a host before link filtering.                                                                                |
| `URL_ALLOWLIST_REGEX`                       | empty                                                            | Comma-separated list of regular expressions. If defined, only URLs matching at least one pattern will be crawled.                                                                                                                                                                                                    |
| `URL_BLOCKLIST_REGEX`                       | empty                                                            | Comma-separated list of regular expressions. URLs matching any pattern will be excluded from crawling. Applied after allowlist.                                                                                                                                                                                      |
| `CHECK_EXTERNAL_LINKS`                      | `false`                                                          | If enabled, dead link detection will also test external links. Otherwise only internal links are checked.                                                                                                                                                                                                            |
| `LH_EVERY_N`                                | `10`                                                             | Run a Lighthouse audit every N HTML pages visited.                                                                                                                                                                                                                                                                   |
| `REPORT_OUTPUT_DIR`                         | `./reports` (`/opt/reports` in the docker image)                 | Path to the directory used to store URL reports (one JSON file per URL).                                                                                                                                                                                                                                             |
| `DUMP_DIR`                                  | empty                                                            | If defined, enables the `site-dump` plugin and writes a local copy of crawled HTML pages and downloaded documents into this directory, rewriting internal `href` and `src` links as relative paths.                                                                                                                  |
| `OUTPUT_FORMAT`                             | `table`                                                          | Controls output format of the crawler results (`json`, `table`, `both` or `none`).                                                                                                                                                                                                                                   |
| `A11Y_AXE_RELEVANT_TAGS`                    | `EN-301-549,best-practice`                                       | Comma-separated list of Axe rule tags to include in accessibility results filtering (e.g. `wcag2a,wcag2aa`).                                                                                                                                                                                                         |
| `DOWNLOAD_OUTPUT_DIR`                       | `./downloads` (`/opt/downloads` in the docker image) `           | Directory where downloaded files are temporarily stored during analysis.                                                                                                                                                                                                                                             |
| `DOWNLOAD_KEEP_FILES`                       | `false`                                                          | If set to `true`, keeps downloaded files on disk instead of deleting them after processing.                                                                                                                                                                                                                          |
| `DOWNLOAD_MAX_EXTRACTED_CHARS`              | `200000`                                                         | Maximum number of characters extracted from a downloaded resource's content.                                                                                                                                                                                                                                         |
| `DOWNLOAD_MAX_PDF_PAGES`                    | `200`                                                            | Maximum number of PDF pages to parse when extracting text from downloaded PDF resources.                                                                                                                                                                                                                             |
| `DOWNLOAD_MAX_LINKS`                        | `500`                                                            | Maximum number of links extracted from a downloaded resource.                                                                                                                                                                                                                                                        |
| `DOWNLOAD_MAX_TEXT_READ_BYTES`              | `5.242.880`                                                      | Maximum file size (in bytes) allowed for text-based extraction from downloaded resources.                                                                                                                                                                                                                            |
| `DOWNLOAD_MAX_BINARY_READ_BYTES`            | `20.971.520`                                                     | Maximum file size (in bytes) allowed for binary document extraction from downloaded resources.                                                                                                                                                                                                                       |
| `DOWNLOAD_ENABLE_TEXTRACT_FALLBACK`         | `true`                                                           | Textract is used only as an optional fallback extractor for unsupported downloaded document formats.<br/>Its dependency tree may trigger npm audit warnings; do not downgrade it automatically with `npm audit fix --force` without validating extractor compatibility.                                              |
| `LANGUAGE_DETECTION_MIN_LENGTH`             | `100`                                                            | Minimum number of content characters required before attempting language detection.                                                                                                                                                                                                                                  |
| `LANGUAGE_DETECTION_MAX_SAMPLE_LENGTH`      | `5000`                                                           | Maximum number of content characters sampled for language detection.                                                                                                                                                                                                                                                 |
| `LANGUAGE_DETECTION_OVERWRITE`              | `false`                                                          | If set to `true`, replaces an existing detected or declared locale with the automatically detected one.                                                                                                                                                                                                              |
| `CONSOLE_AUDIT_ONLY_START_URL`              | `false`                                                          | If set to `true`, console messages are collected only on the start URL instead of on all crawled pages.                                                                                                                                                                                                              |
| `CONSOLE_INCLUDE_WARNINGS`                  | `true`                                                           | If set to `false`, console warnings are ignored and only errors are reported.                                                                                                                                                                                                                                        |
| `CONSOLE_IGNORED_PATTERNS`                  | `favicon\.ico,chrome-extension:\/\/,Failed to load resource: .*` | Comma-separated list of regex patterns used to ignore specific console messages.                                                                                                                                                                                                                                     |
| `MAX_URL_LENGTH`                            | `120`                                                            | Maximum recommended URL length used by the `seo-url-rules` plugin before reporting the `URL_TOO_LONG` finding on HTML pages.                                                                                                                                                                                         |
| `SOFT_404_PATTERNS`                         | built-in multilingual defaults for en, fr, nl and de             | Comma-separated list of regex patterns used by the `soft-http-error` plugin to detect soft 404 pages returned with a successful HTTP status. When defined, it overrides the default soft 404 patterns.                                                                                                               |
| `SOFT_500_PATTERNS`                         | built-in multilingual defaults for en, fr, nl and de             | Comma-separated list of regex patterns used by the `soft-http-error` plugin to detect soft 500 pages returned with a successful HTTP status. When defined, it overrides the default soft 500 patterns.                                                                                                               |
| `PDF_A11Y_MIN_EXTRACTED_CHARS`              | `30`                                                             | Minimum number of extracted characters required before considering that a PDF contains usable text.                                                                                                                                                                                                                  |
| `PDF_A11Y_MAX_PAGES`                        | `200`                                                            | Maximum number of PDF pages analyzed during accessibility heuristics.                                                                                                                                                                                                                                                |
| `PDF_A11Y_LOW_TEXT_THRESHOLD`               | `20`                                                             | Average number of extracted characters per page below which a PDF is considered likely scanned or image-only.                                                                                                                                                                                                        |
| `PDF_A11Y_WARN_MISSING_BOOKMARKS_MIN_PAGES` | `5`                                                              | Minimum number of pages from which missing PDF bookmarks are reported as a warning.                                                                                                                                                                                                                                  |
| `PERF_AUDIT_ONLY_START_URL`                 | `false`                                                          | If set to `true`, collects performance metrics only for the start URL instead of all crawled pages.                                                                                                                                                                                                                  |
| `PERF_SLOW_RESOURCE_THRESHOLD_MS`           | `1000`                                                           | Minimum resource duration in milliseconds before a resource is reported as slow.                                                                                                                                                                                                                                     |
| `PERF_LARGE_RESOURCE_THRESHOLD_BYTES`       | `500000`                                                         | Minimum resource transfer size in bytes before a resource is reported as large.                                                                                                                                                                                                                                      |
| `PERF_MAX_REPORTED_RESOURCES`               | `10`                                                             | Maximum number of slowest and largest resources included in the report.                                                                                                                                                                                                                                              |
| `PERF_HIGH_RESOURCE_COUNT_THRESHOLD`        | `100`                                                            | Number of loaded resources above which the page is reported as resource-heavy.                                                                                                                                                                                                                                       |
| `PERF_LARGE_TRANSFER_THRESHOLD_BYTES`       | `3000000`                                                        | Total transferred bytes threshold above which the page is reported as heavy.                                                                                                                                                                                                                                         |
| `PERF_SLOW_LOAD_THRESHOLD_MS`               | `3000`                                                           | Load event threshold in milliseconds above which the page is reported as slow.                                                                                                                                                                                                                                       |
| `PERF_SLOW_DOMCONTENTLOADED_THRESHOLD_MS`   | `1500`                                                           | DOMContentLoaded threshold in milliseconds above which the page is reported as slow.                                                                                                                                                                                                                                 |
| `CSS_MAX_INLINE_STYLE_ATTRIBUTES`           | `0`                                                              | Warns when a page contains more inline `style` attributes than this threshold.                                                                                                                                                                                                                                       |
| `CSS_MAX_STYLE_TAGS`                        | `0`                                                              | Warns when a page contains more `<style>` tags than this threshold.                                                                                                                                                                                                                                                  |
| `IMAGE_LAZY_LOADING_ABOVE_FOLD_BUFFER_PX`   | `200`                                                            | Additional pixel buffer below the initial viewport before the `image-audit` plugin warns that an image should use `loading="lazy"`.                                                                                                                                                                                  |
| `IMAGE_MIN_LAZY_LOADING_WIDTH_PX`           | `80`                                                             | Minimum rendered image width before the `image-audit` plugin evaluates whether lazy loading is expected.                                                                                                                                                                                                             |
| `IMAGE_MIN_LAZY_LOADING_HEIGHT_PX`          | `80`                                                             | Minimum rendered image height before the `image-audit` plugin evaluates whether lazy loading is expected.                                                                                                                                                                                                            |
| `IMAGE_METADATA_MAX_FILE_SIZE_BYTES`        | `20971520`                                                       | Maximum file size in bytes that `image-metadata` will parse before emitting `IMAGE_METADATA_SKIPPED_TOO_LARGE`.                                                                                                                                                                                                      |
| `TLS_CERT_AUDIT_ONLY_START_URL`             | `true`                                                           | If set to true, audits the TLS certificate only for the start URL.                                                                                                                                                                                                                                                   |
| `TLS_CERT_WARN_IF_EXPIRES_IN_DAYS`          | `30`                                                             | Warns when the TLS certificate expires in N days or less.                                                                                                                                                                                                                                                            |
| `TLS_CERT_TIMEOUT_MS`                       | `10000`                                                          | Maximum time in milliseconds allowed for the TLS certificate inspection.                                                                                                                                                                                                                                             |
| `TLS_CERT_MIN_TLS_VERSION `                 | `TLSv1.2`                                                        | Minimum accepted negotiated TLS version (TLSv1.2 or TLSv1.3).                                                                                                                                                                                                                                                        |
| `TLS_CERT_MIN_SCORE_FOR_ERROR`              | `50`                                                             | Marks the TLS certificate score finding as an error below this score.                                                                                                                                                                                                                                                |
| `CLIENT_PUBLIC_IPV4_URL`                    | `https://ipv4.icanhazip.com/`                                    | Public service queried to resolve the audit runner public IPv4 address for the `engine` report.                                                                                                                                                                                                                      |
| `CLIENT_PUBLIC_IPV6_URL`                    | `https://ipv6.icanhazip.com/`                                    | Public service queried to resolve the audit runner public IPv6 address for the `engine` report.                                                                                                                                                                                                                      |
| `CLIENT_PUBLIC_IP_TIMEOUT_MS`               | `5000`                                                           | Timeout in milliseconds for resolving the audit runner public IPv4/IPv6 addresses.                                                                                                                                                                                                                                   |
| `IP_SUPPORT_AUDIT_ONLY_START_URL`           | `true`                                                           | If set to true, audits IP support only for the start URL.                                                                                                                                                                                                                                                            |
| `IP_SUPPORT_TIMEOUT_MS`                     | `5000`                                                           | Maximum time in milliseconds allowed for IPv4/IPv6 connectivity checks.                                                                                                                                                                                                                                              |
| `IP_SUPPORT_TEST_CONNECTIVITY`              | `false`                                                          | If set to true, also tests TCP connectivity over IPv4 and IPv6.                                                                                                                                                                                                                                                      |
| `COOKIE_MAX_LIFETIME_DAYS`                  | `365`                                                            | Warns when a cookie lifetime exceeds this number of days.                                                                                                                                                                                                                                                            |
| `ROBOTS_TXT_REQUIRE_CRAWL_DELAY`            | `true`                                                           | When enabled, `robots-txt` warns if the `User-agent: *` group does not define a `Crawl-delay`.                                                                                                                                                                                                                       |
| `ROBOTS_TXT_REQUIRE_SITEMAP`                | `true`                                                           | When enabled, `robots-txt` warns if `robots.txt` does not declare any `Sitemap` directive.                                                                                                                                                                                                                           |
| `SIMPLIFIED_AUDIT_LOCALES`                  | `fr,nl,de,en`                                                    | Comma-separated list of locales for the simplified audit HTML pages. Supported values: `fr`, `nl`, `de`, `en`. Invalid entries are ignored, and the default set is used if none remain.                                                                                                                              |

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

| Plugin             | Code                       | Description                                                       | Profiles           | Recommended Actions                          |
| ------------------ | -------------------------- | ----------------------------------------------------------------- | ------------------ | -------------------------------------------- |
| language-detection | LANGUAGE_UNDETERMINED      | Language not detected                                             | Copywriter         | Define lang                                  |
| language-detection | LANGUAGE_DETECTION_SKIPPED | Detection skipped                                                 | Integrator         | Adjust config                                |
| language-detection | LANGUAGE_MISMATCHED        | Detected language does not match the resource's defined language. | Copywriter         | Adjust content                               |
| html-processor     | LOW_CONTENT                | Not enough content                                                | Copywriter         | Add content                                  |
| html-processor     | MAIL_OR_TEL_LINK           | mailto/tel link detected                                          | Webmaster          | Validate usage                               |
| html-processor     | INVALID_MAILTO_HREF        | Invalid mailto href format                                        | Webmaster          | Fix the email link                           |
| html-processor     | INVALID_TEL_HREF           | Invalid tel href format                                           | Webmaster          | Fix the phone link                           |
| html-processor     | INLINE_SCRIPT_TAG          | Inline <script> tag detected                                      | Frontend, Security | Move to external JS or review necessity      |
| html-processor     | INLINE_EVENT_HANDLER       | Inline event handler attribute detected                           | Frontend, Security | Remove inline handlers and bind events in JS |
| html-processor     | JAVASCRIPT_URL             | `javascript:` URL detected                                        | Frontend, Security | Replace with safe links or JS bindings       |
| html-processor     | TITLE_MISSING              | Missing title                                                     | SEO, Copywriter    | Add title                                    |
| html-processor     | TITLE_TOO_SHORT            | Too short                                                         | SEO                | Improve                                      |
| html-processor     | TITLE_TOO_LONG             | Too long                                                          | SEO                | Shorten                                      |
| html-processor     | TITLE_BRAND_TOO_LONG       | Brand too long                                                    | SEO                | Reduce                                       |
| html-processor     | TITLE_BRAND_DUPLICATED     | Brand duplicated                                                  | SEO                | Fix                                          |
| html-processor     | TITLE_MAIN_TOO_SHORT       | Main part too short                                               | SEO                | Improve                                      |
| html-processor     | TITLE_TOO_MANY_PARTS       | Too many segments                                                 | SEO                | Simplify                                     |
| seo-url-rules      | URL_CONSECUTIVE_HYPHENS    | URL contains consecutive hyphens                                  | SEO, Integrator    | Simplify slug                                |
| seo-url-rules      | URL_UNDERSCORE             | URL contains an underscore                                        | SEO, Integrator    | Replace with hyphen                          |
| seo-url-rules      | URL_TECHNICAL_EXTENSION    | URL exposes a technical file extension                            | SEO, Integrator    | Remove extension                             |
| seo-url-rules      | URL_UPPERCASE              | URL contains uppercase characters                                 | SEO, Integrator    | Use lowercase                                |
| seo-url-rules      | URL_TOO_LONG               | URL is excessively long                                           | SEO, Integrator    | Shorten URL                                  |
| seo-url-rules      | URL_SPECIAL_CHARACTERS     | URL contains special or accented characters                       | SEO, Integrator    | Normalize slug                               |
| seo-url-rules      | URL_SPACE                  | URL contains spaces                                               | SEO, Integrator    | Remove spaces                                |
| soft-http-error    | SOFT_404_DETECTED          | Page looks like a soft 404 while returning a successful HTTP code | Webmaster          | Fix status or page                           |
| soft-http-error    | SOFT_500_DETECTED          | Page looks like a soft 500 while returning a successful HTTP code | Webmaster          | Fix status or page                           |

### URL / Crawl

| Plugin              | Code                      | Description           | Profiles       | Recommended Actions |
| ------------------- | ------------------------- | --------------------- | -------------- | ------------------- |
| html-processor      | MISSING_URL               | URL missing           | Integrator     | Fix                 |
| html-processor      | EMPTY_URL                 | Empty URL             | Integrator     | Fix                 |
| html-processor      | NOT_PARSABLE_URL          | Invalid URL           | Integrator     | Fix                 |
| standard-urls-audit | STANDARD_URL_NOT_ENQUEUED | Canonical not crawled | Integrator     | Fix crawler         |
| standard-urls-audit | STANDARD_URL_MISSING      | Canonical URL missing | Webmaster, SEO | Add canonical link  |

### Robots.txt

| Plugin     | Code                           | Description                   | Profiles        | Recommended Actions   |
| ---------- | ------------------------------ | ----------------------------- | --------------- | --------------------- |
| robots-txt | ROBOTS_TXT_USER_AGENT_MISSING  | Missing `User-agent: *` group | SEO, Integrator | Add wildcard group    |
| robots-txt | ROBOTS_TXT_SITEMAP_MISSING     | Missing sitemap declaration   | SEO, Integrator | Add Sitemap           |
| robots-txt | ROBOTS_TXT_CRAWL_DELAY_MISSING | Missing crawl delay           | Infra, SEO      | Add Crawl-delay       |
| robots-txt | ROBOTS_TXT_CRAWL_DELAY_INVALID | Invalid crawl delay value     | Infra           | Fix value             |
| robots-txt | ROBOTS_TXT_BLOCKS_ALL_CRAWLERS | Blocks all crawlers           | SEO, Webmaster  | Review blocking rules |
| robots-txt | ROBOTS_TXT_BLOCKS_CSS          | Blocks used CSS resource      | Frontend, SEO   | Allow required CSS    |
| robots-txt | ROBOTS_TXT_BLOCKS_JS           | Blocks used JavaScript        | Frontend, SEO   | Allow required JS     |
| robots-txt | ROBOTS_TXT_BLOCKS_IMAGE        | Blocks used image resource    | Frontend, SEO   | Allow required images |

### Sitemap

| Plugin  | Code                              | Description                      | Profiles        | Recommended Actions            |
| ------- | --------------------------------- | -------------------------------- | --------------- | ------------------------------ |
| sitemap | SITEMAP_INVALID_XML               | Invalid sitemap XML              | Integrator      | Fix sitemap serialization      |
| sitemap | SITEMAP_INVALID_ROOT              | Invalid sitemap root element     | Integrator, SEO | Use `urlset` or `sitemapindex` |
| sitemap | SITEMAP_INVALID_URL               | Invalid sitemap `loc`            | Integrator, SEO | Fix invalid or missing URLs    |
| sitemap | SITEMAP_DUPLICATE_URL             | Duplicate sitemap URL            | SEO             | Remove duplicates              |
| sitemap | SITEMAP_PAGE_MISSING_FROM_SITEMAP | Crawled page absent from sitemap | SEO, Integrator | Add page to sitemap            |

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
| security-headers | COOKIE_EXCESSIVE_LIFETIME           | Excessive lifetime                   | Integrator | Reduce persistence  |
| security-headers | COOKIE_THIRD_PARTY_DETECTED         | Third-party cookie detected          | Integrator | Review cookie scope |
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

### Image Audit

The `image-audit` plugin inspects HTML `<img>` usage and emits the following performance-oriented findings:

#### `IMAGE_MISSING_LAZY_LOADING`

A below-the-fold image does not use `loading="lazy"`.

Why it matters:
Images that are initially outside the viewport may still be fetched eagerly, which increases network contention and slows down meaningful rendering.

Typical fix:
Add `loading="lazy"` to non-critical images rendered below the fold, or adjust the image plugin thresholds if the page has a justified eager-loading strategy.

#### `IMAGE_MISSING_DIMENSIONS`

An image is rendered without explicit `width` and/or `height` attributes.

Why it matters:
Missing intrinsic dimensions can contribute to layout shifts during page load, especially when image assets load after text and surrounding components.

Typical fix:
Set explicit `width` and `height` attributes matching the image ratio, or render the image through a component that reserves the correct layout space.

#### `IMAGE_NON_OPTIMIZED_FORMAT`

An image uses a legacy raster format without an obvious modern alternative such as AVIF or WebP.

Why it matters:
JPEG, PNG, GIF, BMP, and TIFF assets are often heavier than equivalent modern encodings, especially when no responsive `<picture>` source is provided.

Typical fix:
Prefer AVIF or WebP when compatible with your delivery stack, or serve responsive image sources through `<picture>` and `source[type]`.

### Image Metadata

The `image-metadata` plugin extracts technical metadata from downloaded image files and can emit the following findings:

#### `IMAGE_METADATA_SKIPPED_TOO_LARGE`

Image metadata extraction was skipped because the downloaded file is larger than `IMAGE_METADATA_MAX_FILE_SIZE_BYTES`.

Why it matters:
Very large binaries are expensive to read and parse during a crawl, especially when the goal is metadata inspection rather than full media processing.

Typical fix:
Raise `IMAGE_METADATA_MAX_FILE_SIZE_BYTES` if large source files are expected, or keep the threshold low to preserve crawl throughput.

#### `IMAGE_METADATA_EXTRACTION_FAILED`

The file looked like a supported image, but metadata extraction failed.

Why it matters:
This usually means the file is corrupted, mislabeled, truncated, or uses a structure the parser does not recognize.

Typical fix:
Validate the downloaded asset, verify the MIME type and file integrity, or extend the parser if the format is intentionally supported in your workflow.

#### `IMAGE_COPYRIGHT_MISSING`

The image metadata does not contain copyright information.

Why it matters:
Missing copyright metadata weakens ownership traceability and can make downstream reuse, legal review, or DAM workflows harder to enforce.

Typical fix:
Write copyright information into the source asset metadata before publication, or explicitly exempt assets that are not expected to carry rights metadata.

The plugin writes extracted metadata into `report.metas` using keys such as `image_mime`, `image_format`, `image_width`, `image_height`, `image_bit_depth`, `image_color_type`, `image_progressive`, `image_animated`, `image_exif_orientation`, and `image_copyright` when available.

### Hreflang

The `hreflang` plugin audits alternate language declarations on HTML pages and can emit the following warnings:

#### `HREFLANG_MISSING`

No `link[rel="alternate"][hreflang]` tags were found on the page.

Why it matters:
This usually means localized variants are not declared for search engines, which can reduce the quality of international targeting.

Typical fix:
Add `hreflang` alternate links in the page head for each language or regional variant you publish.

#### `HREFLANG_INVALID_CODE`

A `hreflang` value uses an invalid format such as `fr_BE` instead of `fr-BE`.

Why it matters:
Search engines expect language and regional subtags to use hyphen-separated values. Invalid codes may be ignored.

Typical fix:
Use values such as `fr`, `fr-BE`, `nl-NL`, or `x-default`. Avoid underscores.

#### `HREFLANG_LANGUAGE_MISMATCH`

The self-referencing `hreflang` value does not match the page language detected or declared by the auditor.

Why it matters:
If a page identifies itself as one language while its own `hreflang` points to another, search engines receive conflicting signals.

Typical fix:
Ensure the page language, the `lang` attribute, the textual content, and the self-referencing `hreflang` all describe the same language.

#### `HREFLANG_SELF_REFERENCE_MISSING`

The page does not include a self-referencing `hreflang` entry pointing to its own canonical URL.

Why it matters:
Without a self-reference, the alternate set is incomplete and search engines may interpret the cluster less reliably.

Typical fix:
Add a `hreflang` alternate entry for the current page URL using the correct language or language-region code.

#### `HREFLANG_X_DEFAULT_MISSING`

No `x-default` entry is present in the `hreflang` set.

Why it matters:
`x-default` helps define the fallback page for users whose language or region does not match the declared alternates.

Typical fix:
Add one `x-default` alternate pointing to the default or language selector version of the page.

#### `HREFLANG_DUPLICATE`

The page declares the same `hreflang` and target URL combination more than once.

Why it matters:
Duplicate alternate declarations add noise and make the implementation harder to trust and maintain.

Typical fix:
Keep only one unique alternate declaration per `hreflang` and target URL pair.

#### `HREFLANG_CROSS_LINK_MISSING`

A page links to an alternate language page, but the target page does not link back to the source page in its own `hreflang` set.

Why it matters:
`hreflang` relationships are expected to be reciprocal. Missing return links weaken the consistency of the alternate cluster.

Typical fix:
Ensure every alternate page declares the full cluster, including a return link to each related page.

### CSS Audit Warnings

The `css-audit` plugin can emit the following warnings and errors:

#### `STYLESHEET_MISSING_HREF`

A stylesheet link was detected without an `href` attribute.

Why it matters:
The browser cannot load the stylesheet resource if the target URL is missing.

Typical fix:
Add a valid `href` to the `link rel="stylesheet"` tag or remove the broken tag.

#### `STYLESHEET_HTTP_ERROR`

A stylesheet request completed with an HTTP error status such as `404` or `500`.

Why it matters:
The page may render without the expected CSS, which can break layout, readability, or interaction behavior.

Typical fix:
Restore the missing stylesheet, fix the URL, or correct the server-side error on the CSS asset.

#### `STYLESHEET_REQUEST_FAILED`

A stylesheet request failed before a valid HTTP response was received.

Why it matters:
This often indicates a network error, blocked request, invalid URL, or browser-level loading failure.

Typical fix:
Check the stylesheet URL, browser console/network logs, CSP rules, and any request blocking or redirect issues.

#### `INLINE_STYLE_ATTRIBUTES_EXCESSIVE`

The page contains more inline `style` attributes than allowed by `CSS_MAX_INLINE_STYLE_ATTRIBUTES`.

Why it matters:
Excessive inline styling usually makes front-end code harder to maintain and reduces style reuse and consistency.

Typical fix:
Move repeated inline styles into shared CSS classes or external stylesheets, or adjust the threshold if the page has a justified exception.

#### `STYLE_TAGS_EXCESSIVE`

The page contains more `<style>` tags than allowed by `CSS_MAX_STYLE_TAGS`.

Why it matters:
A high number of style blocks often signals fragmented CSS generation, duplicated styles, or weak asset consolidation.

Typical fix:
Merge redundant style blocks, move page-level CSS into bundled stylesheets, or raise the threshold only when the platform legitimately injects scoped styles.

#### `CSS_SMOOTH_SCROLL_VALIDATION_RISK`

The page contains a `scroll-behavior: smooth` rule.

Why it matters:
Smooth scrolling may interfere with form validation UX, especially when scripts scroll users to invalid fields or error summaries.

Typical fix:
Remove or scope `scroll-behavior: smooth` where form validation flows rely on immediate focus and positioning, or explicitly disable smooth scrolling in those contexts.

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
