import type { ResourceContext, ResourceReport } from "./types.js";

export function createInitialReport(
    ctx: Pick<ResourceContext, "url" | "status" | "mime">,
): ResourceReport {
    return {
        url: ctx.url,
        redirected: false,
        host: null,
        base_url: null,
        timestamp: new Date().toISOString(),
        is_web: false,
        status_code: ctx.status ?? null,
        message: null,
        mimetype: ctx.mime ?? null,
        meta_title: null,
        title: null,
        locale: null,
        links: [],
        pa11y: [],
        description: null,
        content: null,
        findings: [],
        size: null,
    };
}
