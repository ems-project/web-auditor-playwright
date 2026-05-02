# AGENTS.md

Guidance for AI agents working on this project.

## Project Context

Web Auditor is an open-source website auditing tool built on Playwright. The crawler loads pages, detects resources, and runs specialized plugins to produce findings, JSON/XLSX reports, a sitemap, and HTML summary pages.

The public behavior and environment variables are documented in `README.md`. Treat the README as the functional source of truth before adding or changing any user-facing option.

## Useful Structure

- `src/index.ts` builds configuration from environment variables, registers plugins, and starts the engine.
- `src/engine/` contains the crawler core, plugin registry, shared types, SQLite storage, progress web server, and report page generation.
- `src/engine/BasePlugin.ts` provides the base plugin class: counters, state hydration, `registerInfo`, `registerWarning`, `registerError` helpers, and resource audit tracking.
- `src/engine/types.ts` defines shared contracts such as `IPlugin`, `ResourceContext`, `PluginPhase`, `FindingCode`, and `FindingCategory`.
- `src/plugins/` contains audit and extraction plugins.
- `src/utils/` contains shared utilities.
- `src/reporting/` contains report exporters.
- `src/resources/` contains EJS templates, assets, and translations copied into `dist/resources` during build.
- `tests/` contains native Node.js tests written in TypeScript.
- `dist/`, `reports/`, and `downloads/` are generated outputs. Do not edit them unless explicitly requested.

## Commands

- Install dependencies: `npm install`
- Install Playwright browsers: `npx playwright install`
- Run in development: `npm run dev`
- Build: `npm run build`
- Run built output: `npm start`
- Test: `npm test`
- Lint: `npm run lint`
- Format: `npm run format`
- Check formatting: `npm run format:check`

Example local audit:

```bash
START_URL=https://your-site.com WEBSITE_ID=your_site RATE_LIMIT_MS=400 npm run dev
```

The progress web server is enabled by default on `WEB_UI_HOST`/`WEB_UI_PORT` (`127.0.0.1:3030` outside Docker). Pressing `s` requests a graceful stop.

## TypeScript Conventions

- The project uses ESM (`"type": "module"`) with `moduleResolution: "NodeNext"`.
- Relative imports to TypeScript source use the `.js` extension, for example `../engine/types.js`.
- TypeScript is strict; avoid `any` and prefer updating shared types when a contract is durable.
- Prettier style uses double quotes, semicolons, trailing commas, 100-column width, and 4-space indentation.
- `no-console` is allowed, but keep console output useful for audit progress and diagnostics.

## Adding or Updating a Plugin

Plugins implement `IPlugin` and usually extend `BasePlugin`.

Follow these rules:

- Define a stable kebab-case `name`. This name is used by `DISABLED_PLUGINS`, reports, and summaries.
- Declare the required `phases`: `beforeGoto`, `afterGoto`, `process`, `periodic`, `download`, `error`, `beforeFinally`, or `finally`.
- Implement `applies(ctx)` to limit the plugin scope cleanly, such as HTML only, start URL only, or downloaded resources only.
- In `run(phase, ctx)`, use data from `ResourceContext`: `page`, `response`, `downloaded`, `report`, `crawler`, `engineState`, and `findings`.
- Register conclusions with `registerInfo`, `registerWarning`, or `registerError` so counters and persistable state stay consistent.
- Call `register(ctx)` when the plugin audited a resource without producing a finding.
- Add new finding codes to `FindingCode` in `src/engine/types.ts`, except for special cases such as Axe codes handled through `registerA11yFinding`.
- Prefer an existing `FindingCategory` instead of adding a new category without a clear need.
- If the plugin keeps global state, store it in `ctx.engineState.any` under a key namespaced by the plugin name. Hydrate this state on resume when needed.
- Register the plugin in `src/index.ts` and expose options through environment variables only when they are useful to users.
- Document every new environment variable in `README.md`.

The registry catches plugin exceptions and emits an `UNEXPECTED_ERROR` finding. Do not silently hide errors when they mean an audit is incomplete.

## Engine and Persistence

- `CrawlerEngine` drives navigation, the URL queue, plugin phases, and persistence.
- `AuditStore` manages the `audit.db` SQLite database, runs, inventory, findings, links, and resumable state.
- Audit resume uses `RESUME_RUN_ID`; do not break data stored in `engineState.any` or existing migrations.
- If the SQLite schema changes, add a migration in `src/resources/db/migrations/` and verify the build copies `src/resources` to `dist/resources`.
- Discovered links must go through `ctx.crawler.enqueueUrl(...)` so depth, allowlist, blocklist, origin, limits, and graceful stop rules are respected.

## Reports and UI

- Final reports are written under `REPORT_OUTPUT_DIR/WEBSITE_ID`.
- HTML pages use EJS templates from `src/resources/templates/`.
- Simplified audit translations live in `src/resources/i18n/`.
- When changing report data, check every consumer: per-URL JSON, `report.json`, `report.xlsx`, sitemap, progress pages, and summary pages.
- Avoid adding untranslated visible text to the simplified report when the view exists in multiple languages.

## Tests

- Tests use `node:test` and `node:assert/strict`.
- TypeScript tests are run with `node --import tsx --test tests/**/*.test.ts`.
- Add or update a test when changing an audit rule, parser, shared helper, migration, or report format.
- For plugins, test pure functions and edge cases where possible: missing MIME, HTTP error, invalid URL, oversized resource, empty content, and resumed state.
- Before finishing a code change, run at least `npm test` and `npm run lint` when the environment allows it.

## Contribution Hygiene

- Do not modify `dist/`, `reports/`, `downloads/`, `.DS_Store`, or IDE files unless explicitly requested.
- Do not delete files generated by an existing audit without approval.
- Keep changes scoped: one plugin or one engine area at a time, unless a shared contract requires coordinated changes.
- Preserve existing environment variables and documented defaults.
- For network audits, prefer explicit timeouts and size limits so a crawl cannot stall indefinitely.
- External checks must remain configurable because they can be slow, flaky, or unwanted in CI.
- Do not make network calls in unit tests; use fixtures, mocks, or pure functions.

## Definition of Done

A change is ready when:

- behavior is implemented in `src/` with shared contracts updated;
- relevant tests pass, or any inability to run them is explained;
- `README.md` is updated for every new or changed user-facing option;
- required migrations or resources are added;
- no unrelated generated artifact is included.
