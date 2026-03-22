import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type SecurityHeadersPluginOptions = {
    auditOnlyStartUrl?: boolean;
};

type ParsedCookie = {
    raw: string;
    name: string;
    attributes: Set<string>;
    sameSite: string | null;
};

export class SecurityHeadersPlugin extends BasePlugin implements IPlugin {
    name = "security-headers";
    phases: PluginPhase[] = ["afterGoto", "error"];

    private readonly auditOnlyStartUrl: boolean;

    constructor(options: SecurityHeadersPluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? true;
    }

    applies(ctx: ResourceContext): boolean {
        return !this.auditOnlyStartUrl || ctx.depth === 0;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (this.auditOnlyStartUrl && ctx.depth !== 0) {
            return;
        }

        if (phase === "error") {
            this.registerWarning(
                ctx,
                "SECURITY_HEADERS_NOT_AUDITED",
                "Could not audit security headers because the start URL failed to load.",
            );
            this.register(ctx);
            return;
        }

        const headers = this.normalizeHeaders(ctx.response?.headers() ?? {});
        const isHttps = this.isHttps(ctx.finalUrl ?? ctx.url);

        this.auditStrictTransportSecurity(ctx, headers, isHttps);
        this.auditContentSecurityPolicy(ctx, headers);
        this.auditFrameProtection(ctx, headers);
        this.auditContentTypeOptions(ctx, headers);
        this.auditReferrerPolicy(ctx, headers);
        this.auditPermissionsPolicy(ctx, headers);
        this.auditCrossOriginHeaders(ctx, headers);
        this.auditCookies(ctx, isHttps);

        this.register(ctx);
    }

    private auditStrictTransportSecurity(
        ctx: ResourceContext,
        headers: Record<string, string>,
        isHttps: boolean,
    ): void {
        const value = headers["strict-transport-security"];

        if (!isHttps) {
            this.registerInfo(
                ctx,
                "HSTS_NOT_APPLICABLE",
                "Strict-Transport-Security is only applicable on HTTPS responses.",
            );
            return;
        }

        if (!value) {
            this.registerError(
                ctx,
                "MISSING_HSTS",
                "Missing Strict-Transport-Security header on HTTPS start URL.",
            );
            return;
        }

        const maxAge = this.extractDirectiveNumber(value, "max-age");

        if (maxAge === null) {
            this.registerWarning(
                ctx,
                "INVALID_HSTS",
                'Strict-Transport-Security header is present but missing a valid "max-age" directive.',
                { value },
            );
            return;
        }

        if (maxAge < 31536000) {
            this.registerWarning(
                ctx,
                "WEAK_HSTS_MAX_AGE",
                `Strict-Transport-Security max-age is lower than one year (${maxAge}).`,
                { value, maxAge },
            );
            return;
        }
    }

    private auditContentSecurityPolicy(
        ctx: ResourceContext,
        headers: Record<string, string>,
    ): void {
        const enforced = headers["content-security-policy"];
        const reportOnly = headers["content-security-policy-report-only"];

        if (enforced) {
            if (
                !this.hasDirective(enforced, "default-src") &&
                !this.hasDirective(enforced, "script-src")
            ) {
                this.registerWarning(
                    ctx,
                    "WEAK_CSP",
                    "Content-Security-Policy header is present but does not define default-src or script-src.",
                    { value: enforced },
                );
            }

            return;
        }

        if (reportOnly) {
            this.registerWarning(
                ctx,
                "CSP_REPORT_ONLY_ONLY",
                "Only Content-Security-Policy-Report-Only is present; no enforced Content-Security-Policy header was found.",
                { value: reportOnly },
            );
            return;
        }

        this.registerError(ctx, "MISSING_CSP", "Missing Content-Security-Policy header.");
    }

    private auditFrameProtection(ctx: ResourceContext, headers: Record<string, string>): void {
        const xfo = headers["x-frame-options"];
        const csp = headers["content-security-policy"];

        const hasFrameAncestors = csp ? this.hasDirective(csp, "frame-ancestors") : false;

        if (!xfo && !hasFrameAncestors) {
            this.registerWarning(
                ctx,
                "MISSING_CLICKJACKING_PROTECTION",
                "Missing both X-Frame-Options and CSP frame-ancestors protections.",
            );
            return;
        }

        if (xfo) {
            const normalized = xfo.trim().toUpperCase();
            if (!["DENY", "SAMEORIGIN"].includes(normalized)) {
                this.registerWarning(
                    ctx,
                    "WEAK_X_FRAME_OPTIONS",
                    "X-Frame-Options header is present but has an uncommon value.",
                    { value: xfo },
                );
            }
        }
    }

    private auditContentTypeOptions(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["x-content-type-options"];

        if (!value) {
            this.registerWarning(
                ctx,
                "MISSING_X_CONTENT_TYPE_OPTIONS",
                "Missing X-Content-Type-Options header.",
            );
            return;
        }

        if (value.trim().toLowerCase() !== "nosniff") {
            this.registerWarning(
                ctx,
                "INVALID_X_CONTENT_TYPE_OPTIONS",
                'X-Content-Type-Options header should usually be set to "nosniff".',
                { value },
            );
            return;
        }
    }

    private auditReferrerPolicy(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["referrer-policy"];

        if (!value) {
            this.registerWarning(ctx, "MISSING_REFERRER_POLICY", "Missing Referrer-Policy header.");
            return;
        }

        const normalized = value.trim().toLowerCase();

        if (
            ![
                "no-referrer",
                "same-origin",
                "strict-origin",
                "strict-origin-when-cross-origin",
                "origin",
                "origin-when-cross-origin",
                "no-referrer-when-downgrade",
                "unsafe-url",
            ].includes(normalized)
        ) {
            this.registerWarning(
                ctx,
                "INVALID_REFERRER_POLICY",
                "Referrer-Policy header is present but has an unrecognized value.",
                { value },
            );
            return;
        }

        if (normalized === "unsafe-url") {
            this.registerWarning(
                ctx,
                "WEAK_REFERRER_POLICY",
                'Referrer-Policy is set to "unsafe-url", which is generally too permissive.',
                { value },
            );
            return;
        }
    }

    private auditPermissionsPolicy(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["permissions-policy"];

        if (!value) {
            this.registerInfo(
                ctx,
                "MISSING_PERMISSIONS_POLICY",
                "Permissions-Policy header is not present.",
            );
            return;
        }
    }

    private auditCrossOriginHeaders(ctx: ResourceContext, headers: Record<string, string>): void {
        const coop = headers["cross-origin-opener-policy"];
        const corp = headers["cross-origin-resource-policy"];

        if (!coop) {
            this.registerInfo(
                ctx,
                "MISSING_COOP",
                "Cross-Origin-Opener-Policy header is not present.",
            );
        }

        if (!corp) {
            this.registerInfo(
                ctx,
                "MISSING_CORP",
                "Cross-Origin-Resource-Policy header is not present.",
            );
        }
    }

    private auditCookies(ctx: ResourceContext, isHttps: boolean): void {
        const setCookieHeaders = this.getSetCookieHeaders(ctx);

        if (setCookieHeaders.length === 0) {
            return;
        }

        const parsedCookies = setCookieHeaders
            .map((value) => this.parseSetCookie(value))
            .filter((cookie): cookie is ParsedCookie => cookie !== null);

        for (const cookie of parsedCookies) {
            const hasSecure = cookie.attributes.has("secure");
            const hasHttpOnly = cookie.attributes.has("httponly");
            const sameSite = cookie.sameSite;

            if (isHttps && !hasSecure) {
                this.registerWarning(
                    ctx,
                    "COOKIE_MISSING_SECURE",
                    `Cookie "${cookie.name}" is missing the Secure attribute on an HTTPS response.`,
                    { cookie: cookie.raw },
                );
            }

            if (!hasHttpOnly) {
                this.registerWarning(
                    ctx,
                    "COOKIE_MISSING_HTTPONLY",
                    `Cookie "${cookie.name}" is missing the HttpOnly attribute.`,
                    { cookie: cookie.raw },
                );
            }

            if (!sameSite) {
                this.registerWarning(
                    ctx,
                    "COOKIE_MISSING_SAMESITE",
                    `Cookie "${cookie.name}" is missing the SameSite attribute.`,
                    { cookie: cookie.raw },
                );
            } else if (!["lax", "strict", "none"].includes(sameSite)) {
                this.registerWarning(
                    ctx,
                    "COOKIE_INVALID_SAMESITE",
                    `Cookie "${cookie.name}" has an invalid SameSite attribute.`,
                    { cookie: cookie.raw, sameSite },
                );
            } else if (sameSite === "none" && !hasSecure) {
                this.registerWarning(
                    ctx,
                    "COOKIE_SAMESITE_NONE_WITHOUT_SECURE",
                    `Cookie "${cookie.name}" uses SameSite=None without Secure.`,
                    { cookie: cookie.raw },
                );
            }
        }
    }

    private getSetCookieHeaders(ctx: ResourceContext): string[] {
        const responseHeadersArray = ctx.response?.headersArray?.();
        if (Array.isArray(responseHeadersArray)) {
            return responseHeadersArray
                .filter((header) => header.name.toLowerCase() === "set-cookie")
                .map((header) => header.value)
                .filter((value) => value.trim().length > 0);
        }

        const headers = ctx.response?.headers?.() ?? {};
        const raw = headers["set-cookie"] ?? headers["Set-Cookie"];
        if (!raw) {
            return [];
        }

        return [raw];
    }

    private parseSetCookie(value: string): ParsedCookie | null {
        const parts = value
            .split(";")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
        if (parts.length === 0) {
            return null;
        }

        const nameValue = parts[0];
        const separatorIndex = nameValue.indexOf("=");
        if (separatorIndex <= 0) {
            return null;
        }

        const name = nameValue.slice(0, separatorIndex).trim();
        if (!name) {
            return null;
        }

        const attributes = new Set<string>();
        let sameSite: string | null = null;

        for (const attributePart of parts.slice(1)) {
            const [rawName, rawValue] = attributePart.split("=", 2);
            const attributeName = rawName.trim().toLowerCase();
            attributes.add(attributeName);

            if (attributeName === "samesite") {
                sameSite = (rawValue ?? "").trim().toLowerCase() || null;
            }
        }

        return {
            raw: value,
            name,
            attributes,
            sameSite,
        };
    }

    private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
        const normalized: Record<string, string> = {};

        for (const [key, value] of Object.entries(headers)) {
            normalized[key.toLowerCase()] = value;
        }

        return normalized;
    }

    private isHttps(url: string): boolean {
        try {
            return new URL(url).protocol === "https:";
        } catch {
            return false;
        }
    }

    private extractDirectiveNumber(value: string, directiveName: string): number | null {
        const regex = new RegExp(`${directiveName}\\s*=\\s*(\\d+)`, "i");
        const match = value.match(regex);
        if (!match) {
            return null;
        }

        const parsed = Number(match[1]);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private hasDirective(value: string, directiveName: string): boolean {
        return value
            .split(";")
            .map((part) => part.trim().toLowerCase())
            .some((part) => part === directiveName || part.startsWith(`${directiveName} `));
    }
}
