import { BasePlugin } from "../engine/BasePlugin.js";
import { EngineState, IPlugin, PluginPhase, Report, ResourceContext } from "../engine/types.js";

type SecurityHeadersPluginOptions = {
    auditOnlyStartUrl?: boolean;
    maxCookieLifetimeDays?: number;
};

type ParsedCookie = {
    raw: string;
    name: string;
    attributes: Set<string>;
    sameSite: string | null;
    secure: boolean;
    httpOnly: boolean;
    domain: string | null;
    path: string | null;
    maxAgeSeconds: number | null;
    expiresAt: string | null;
};

type ObservedCookie = {
    key: string;
    name: string;
    domain: string | null;
    path: string | null;
    sameSite: string | null;
    secure: boolean;
    httpOnly: boolean;
    maxAgeSeconds: number | null;
    expiresAt: string | null;
    thirdParty: boolean;
    firstSeenUrl: string;
};

type ScoreItem = {
    id: string;
    passed: boolean;
    weight: number;
};

type SecurityHeadersState = {
    grade: string;
    score: number;
    cookies: ObservedCookie[];
    cookieKeys: string[];
    reportedCookieFindings: string[];
};

export class SecurityHeadersPlugin extends BasePlugin implements IPlugin {
    name = "security-headers";
    phases: PluginPhase[] = ["afterGoto", "error"];

    private readonly auditOnlyStartUrl: boolean;
    private readonly maxCookieLifetimeDays: number;
    private readonly scoreItems: ScoreItem[] = [];

    constructor(options: SecurityHeadersPluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? true;
        this.maxCookieLifetimeDays = options.maxCookieLifetimeDays ?? 365;
    }

    applies(ctx: ResourceContext): boolean {
        return !this.auditOnlyStartUrl || ctx.depth === 0;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (this.auditOnlyStartUrl && ctx.depth !== 0) {
            return;
        }

        this.scoreItems.length = 0;

        if (phase === "error") {
            this.registerWarning(
                ctx,
                "security",
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
        this.registerScoreSummary(ctx);

        this.register(ctx);
    }

    private auditStrictTransportSecurity(
        ctx: ResourceContext,
        headers: Record<string, string>,
        isHttps: boolean,
    ): void {
        const value = headers["strict-transport-security"];

        if (!isHttps) {
            this.addScore("hsts", true, 10);
            this.registerInfo(
                ctx,
                "security",
                "HSTS_NOT_APPLICABLE",
                "Strict-Transport-Security is only applicable on HTTPS responses.",
            );
            return;
        }

        if (!value) {
            this.addScore("hsts", false, 10);
            this.registerError(
                ctx,
                "security",
                "MISSING_HSTS",
                "Missing Strict-Transport-Security header on HTTPS start URL.",
            );
            return;
        }

        const maxAge = this.extractDirectiveNumber(value, "max-age");

        if (maxAge === null) {
            this.addScore("hsts", false, 10);
            this.registerWarning(
                ctx,
                "security",
                "INVALID_HSTS",
                'Strict-Transport-Security header is present but missing a valid "max-age" directive.',
                { value },
            );
            return;
        }

        if (maxAge < 31536000) {
            this.addScore("hsts", false, 10);
            this.registerWarning(
                ctx,
                "security",
                "WEAK_HSTS_MAX_AGE",
                `Strict-Transport-Security max-age is lower than one year (${maxAge}).`,
                { value, maxAge },
            );
            return;
        }

        this.addScore("hsts", true, 10);
    }

    private auditContentSecurityPolicy(
        ctx: ResourceContext,
        headers: Record<string, string>,
    ): void {
        const enforced = headers["content-security-policy"];
        const reportOnly = headers["content-security-policy-report-only"];

        if (enforced) {
            const hasCoreDirectives =
                this.hasDirective(enforced, "default-src") ||
                this.hasDirective(enforced, "script-src");

            this.addScore("csp", hasCoreDirectives, 20);

            if (!hasCoreDirectives) {
                this.registerWarning(
                    ctx,
                    "security",
                    "WEAK_CSP",
                    "Content-Security-Policy header is present but does not define default-src or script-src.",
                    { value: enforced },
                );
            }

            return;
        }

        if (reportOnly) {
            this.addScore("csp", false, 20);
            this.registerWarning(
                ctx,
                "security",
                "CSP_REPORT_ONLY_ONLY",
                "Only Content-Security-Policy-Report-Only is present; no enforced Content-Security-Policy header was found.",
                { value: reportOnly },
            );
            return;
        }

        this.addScore("csp", false, 20);
        this.registerError(
            ctx,
            "security",
            "MISSING_CSP",
            "Missing Content-Security-Policy header.",
        );
    }

    private auditFrameProtection(ctx: ResourceContext, headers: Record<string, string>): void {
        const xfo = headers["x-frame-options"];
        const csp = headers["content-security-policy"];
        const hasFrameAncestors = csp ? this.hasDirective(csp, "frame-ancestors") : false;

        if (!xfo && !hasFrameAncestors) {
            this.addScore("clickjacking", false, 10);
            this.registerWarning(
                ctx,
                "security",
                "MISSING_CLICKJACKING_PROTECTION",
                "Missing both X-Frame-Options and CSP frame-ancestors protections.",
            );
            return;
        }

        let passed = false;

        if (xfo) {
            const normalized = xfo.trim().toUpperCase();
            if (!["DENY", "SAMEORIGIN"].includes(normalized)) {
                this.registerWarning(
                    ctx,
                    "security",
                    "WEAK_X_FRAME_OPTIONS",
                    "X-Frame-Options header is present but has an uncommon value.",
                    { value: xfo },
                );
            } else {
                passed = true;
            }
        }

        if (hasFrameAncestors) {
            passed = true;
        }

        this.addScore("clickjacking", passed, 10);
    }

    private auditContentTypeOptions(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["x-content-type-options"];

        if (!value) {
            this.addScore("nosniff", false, 10);
            this.registerWarning(
                ctx,
                "security",
                "MISSING_X_CONTENT_TYPE_OPTIONS",
                "Missing X-Content-Type-Options header.",
            );
            return;
        }

        if (value.trim().toLowerCase() !== "nosniff") {
            this.addScore("nosniff", false, 10);
            this.registerWarning(
                ctx,
                "security",
                "INVALID_X_CONTENT_TYPE_OPTIONS",
                'X-Content-Type-Options header should usually be set to "nosniff".',
                { value },
            );
            return;
        }

        this.addScore("nosniff", true, 10);
    }

    private auditReferrerPolicy(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["referrer-policy"];

        if (!value) {
            this.addScore("referrer-policy", false, 8);
            this.registerWarning(
                ctx,
                "security",
                "MISSING_REFERRER_POLICY",
                "Missing Referrer-Policy header.",
            );
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
            this.addScore("referrer-policy", false, 8);
            this.registerWarning(
                ctx,
                "security",
                "INVALID_REFERRER_POLICY",
                "Referrer-Policy header is present but has an unrecognized value.",
                { value },
            );
            return;
        }

        if (normalized === "unsafe-url") {
            this.addScore("referrer-policy", false, 8);
            this.registerWarning(
                ctx,
                "security",
                "WEAK_REFERRER_POLICY",
                'Referrer-Policy is set to "unsafe-url", which is generally too permissive.',
                { value },
            );
            return;
        }

        this.addScore("referrer-policy", true, 8);
    }

    private auditPermissionsPolicy(ctx: ResourceContext, headers: Record<string, string>): void {
        const value = headers["permissions-policy"];

        if (!value) {
            this.addScore("permissions-policy", false, 6);
            this.registerInfo(
                ctx,
                "security",
                "MISSING_PERMISSIONS_POLICY",
                "Permissions-Policy header is not present.",
            );
            return;
        }

        this.addScore("permissions-policy", true, 6);
    }

    private auditCrossOriginHeaders(ctx: ResourceContext, headers: Record<string, string>): void {
        const coop = headers["cross-origin-opener-policy"];
        const corp = headers["cross-origin-resource-policy"];

        const coopValid = typeof coop === "string" && coop.trim().length > 0;
        const corpValid = typeof corp === "string" && corp.trim().length > 0;

        this.addScore("coop", coopValid, 4);
        this.addScore("corp", corpValid, 4);

        if (!coop) {
            this.registerInfo(
                ctx,
                "security",
                "MISSING_COOP",
                "Cross-Origin-Opener-Policy header is not present.",
            );
        }

        if (!corp) {
            this.registerInfo(
                ctx,
                "security",
                "MISSING_CORP",
                "Cross-Origin-Resource-Policy header is not present.",
            );
        }
    }

    private auditCookies(ctx: ResourceContext, isHttps: boolean): void {
        const setCookieHeaders = this.getSetCookieHeaders(ctx);
        const state = this.getState(ctx.engineState);

        if (setCookieHeaders.length === 0) {
            this.addScore("cookies", true, 18);
            return;
        }

        const parsedCookies = setCookieHeaders
            .map((value) => this.parseSetCookie(value))
            .filter((cookie): cookie is ParsedCookie => cookie !== null);

        let allCookiesDefensive = true;

        for (const cookie of parsedCookies) {
            const hasSecure = cookie.secure;
            const hasHttpOnly = cookie.httpOnly;
            const sameSite = cookie.sameSite;
            const sameSiteValid = sameSite !== null && ["lax", "strict", "none"].includes(sameSite);
            const thirdParty = this.isThirdPartyCookie(ctx, cookie);

            this.rememberCookie(ctx, state, cookie, thirdParty);

            if (isHttps && !hasSecure) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_MISSING_SECURE",
                    cookie,
                    `Cookie "${cookie.name}" is missing the Secure attribute on an HTTPS response.`,
                );
            }

            if (!hasHttpOnly) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_MISSING_HTTPONLY",
                    cookie,
                    `Cookie "${cookie.name}" is missing the HttpOnly attribute.`,
                );
            }

            if (!sameSite) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_MISSING_SAMESITE",
                    cookie,
                    `Cookie "${cookie.name}" is missing the SameSite attribute.`,
                );
            } else if (!sameSiteValid) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_INVALID_SAMESITE",
                    cookie,
                    `Cookie "${cookie.name}" has an invalid SameSite attribute.`,
                    { sameSite },
                );
            } else if (sameSite === "none" && !hasSecure) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_SAMESITE_NONE_WITHOUT_SECURE",
                    cookie,
                    `Cookie "${cookie.name}" uses SameSite=None without Secure.`,
                );
            }

            if (thirdParty) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_THIRD_PARTY_DETECTED",
                    cookie,
                    `Cookie "${cookie.name}" targets a third-party domain (${cookie.domain}).`,
                    { domain: cookie.domain },
                );
            }

            const lifetimeDays = this.getCookieLifetimeDays(cookie);
            if (lifetimeDays !== null && lifetimeDays > this.maxCookieLifetimeDays) {
                allCookiesDefensive = false;
                this.registerUniqueCookieWarning(
                    ctx,
                    state,
                    "COOKIE_EXCESSIVE_LIFETIME",
                    cookie,
                    `Cookie "${cookie.name}" has an excessive lifetime (${lifetimeDays.toFixed(1)} days).`,
                    { lifetimeDays, maxAllowedDays: this.maxCookieLifetimeDays },
                );
            }
        }

        this.addScore("cookies", allCookiesDefensive, 18);
    }

    private registerScoreSummary(ctx: ResourceContext): void {
        const maxScore = this.scoreItems.reduce((sum, item) => sum + item.weight, 0);
        const obtainedScore = this.scoreItems
            .filter((item) => item.passed)
            .reduce((sum, item) => sum + item.weight, 0);

        const state = this.getState(ctx.engineState);
        state.score = maxScore > 0 ? Math.round((obtainedScore / maxScore) * 100) : 0;
        state.grade = this.gradeFromScore(state.score);

        const details = this.scoreItems.map((item) => ({
            id: item.id,
            passed: item.passed,
            weight: item.weight,
        }));

        const summary = `HTTP security score for the start URL: ${state.score}/100 (${state.grade}).`;

        if (state.score >= 90) {
            this.registerInfo(ctx, "security", "SECURITY_HEADERS_SCORE", summary, {
                score: state.score,
                grade: state.grade,
                details,
            });
            return;
        }

        if (state.score >= 70) {
            this.registerWarning(ctx, "security", "SECURITY_HEADERS_SCORE", summary, {
                score: state.score,
                grade: state.grade,
                details,
            });
            return;
        }

        this.registerError(ctx, "security", "SECURITY_HEADERS_SCORE", summary, {
            score: state.score,
            grade: state.grade,
            details,
        });
    }

    private gradeFromScore(score: number): string {
        if (score >= 90) return "A";
        if (score >= 80) return "B";
        if (score >= 70) return "C";
        if (score >= 60) return "D";
        if (score >= 50) return "E";
        return "F";
    }

    private addScore(id: string, passed: boolean, weight: number): void {
        this.scoreItems.push({ id, passed, weight });
    }

    private getState(state: EngineState): SecurityHeadersState {
        const existing = state.any[this.name];
        if (this.isSecurityHeadersState(existing)) {
            return existing;
        }

        const created: SecurityHeadersState = {
            grade: "F",
            score: 0,
            cookies: [],
            cookieKeys: [],
            reportedCookieFindings: [],
        };

        state.any[this.name] = created;
        return created;
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
        let domain: string | null = null;
        let path: string | null = null;
        let maxAgeSeconds: number | null = null;
        let expiresAt: string | null = null;

        for (const attributePart of parts.slice(1)) {
            const [rawName, rawValue] = attributePart.split("=", 2);
            const attributeName = rawName.trim().toLowerCase();
            const attributeValue = (rawValue ?? "").trim();
            attributes.add(attributeName);

            if (attributeName === "samesite") {
                sameSite = attributeValue.toLowerCase() || null;
            } else if (attributeName === "domain") {
                domain = attributeValue || null;
            } else if (attributeName === "path") {
                path = attributeValue || null;
            } else if (attributeName === "max-age") {
                const parsed = Number(attributeValue);
                maxAgeSeconds = Number.isFinite(parsed) ? parsed : null;
            } else if (attributeName === "expires") {
                expiresAt = attributeValue || null;
            }
        }

        return {
            raw: value,
            name,
            attributes,
            sameSite,
            secure: attributes.has("secure"),
            httpOnly: attributes.has("httponly"),
            domain,
            path,
            maxAgeSeconds,
            expiresAt,
        };
    }

    private rememberCookie(
        ctx: ResourceContext,
        state: SecurityHeadersState,
        cookie: ParsedCookie,
        thirdParty: boolean,
    ): void {
        const key = this.buildCookieKey(cookie);
        if (state.cookieKeys.includes(key)) {
            return;
        }

        state.cookieKeys.push(key);
        state.cookies.push({
            key,
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            sameSite: cookie.sameSite,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            maxAgeSeconds: cookie.maxAgeSeconds,
            expiresAt: cookie.expiresAt,
            thirdParty,
            firstSeenUrl: ctx.finalUrl ?? ctx.url,
        });
    }

    private registerUniqueCookieWarning(
        ctx: ResourceContext,
        state: SecurityHeadersState,
        code:
            | "COOKIE_MISSING_SECURE"
            | "COOKIE_MISSING_HTTPONLY"
            | "COOKIE_MISSING_SAMESITE"
            | "COOKIE_INVALID_SAMESITE"
            | "COOKIE_SAMESITE_NONE_WITHOUT_SECURE"
            | "COOKIE_EXCESSIVE_LIFETIME"
            | "COOKIE_THIRD_PARTY_DETECTED",
        cookie: ParsedCookie,
        message: string,
        data: Record<string, unknown> = {},
    ): void {
        const findingKey = `${code}|${this.buildCookieKey(cookie)}`;
        if (state.reportedCookieFindings.includes(findingKey)) {
            return;
        }

        state.reportedCookieFindings.push(findingKey);
        this.registerWarning(ctx, "security", code, message, {
            cookie: cookie.raw,
            ...data,
        });
    }

    private buildCookieKey(cookie: ParsedCookie): string {
        return [cookie.name, cookie.domain ?? "", cookie.path ?? ""].join("|");
    }

    private getCookieLifetimeDays(cookie: ParsedCookie): number | null {
        if (typeof cookie.maxAgeSeconds === "number") {
            return cookie.maxAgeSeconds / 86400;
        }

        if (!cookie.expiresAt) {
            return null;
        }

        const expiresAt = new Date(cookie.expiresAt).getTime();
        if (!Number.isFinite(expiresAt)) {
            return null;
        }

        return (expiresAt - Date.now()) / 86400000;
    }

    private isThirdPartyCookie(ctx: ResourceContext, cookie: ParsedCookie): boolean {
        const cookieDomain = this.normalizeCookieDomain(cookie.domain);
        if (!cookieDomain) {
            return false;
        }

        const siteHost = this.getHost(ctx.engineState.origin);
        const currentHost = this.getHost(ctx.finalUrl ?? ctx.url);
        if (!siteHost || !currentHost) {
            return false;
        }

        return (
            !this.hostsRelated(cookieDomain, siteHost) &&
            !this.hostsRelated(cookieDomain, currentHost)
        );
    }

    private hostsRelated(left: string, right: string): boolean {
        return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
    }

    private normalizeCookieDomain(value: string | null): string | null {
        if (!value) {
            return null;
        }

        return value.trim().replace(/^\.+/, "").toLowerCase() || null;
    }

    private getHost(url: string): string | null {
        try {
            return new URL(url).hostname.toLowerCase();
        } catch {
            return null;
        }
    }

    private formatCookieInventoryItem(cookie: ObservedCookie): string {
        const parts = [
            `domain=${cookie.domain ?? "<host-only>"}`,
            `path=${cookie.path ?? "/"}`,
            `SameSite=${cookie.sameSite ?? "<missing>"}`,
            cookie.secure ? "Secure" : "No Secure",
            cookie.httpOnly ? "HttpOnly" : "No HttpOnly",
            cookie.thirdParty ? "Third-party" : "First-party",
        ];

        if (typeof cookie.maxAgeSeconds === "number") {
            parts.push(`Max-Age=${cookie.maxAgeSeconds}`);
        }
        if (cookie.expiresAt) {
            parts.push(`Expires=${cookie.expiresAt}`);
        }
        parts.push(`firstSeen=${cookie.firstSeenUrl}`);

        return parts.join(" | ");
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

    private isSecurityHeadersState(value: unknown): value is SecurityHeadersState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const record = value as Record<string, unknown>;
        return (
            typeof record.grade === "string" &&
            typeof record.score === "number" &&
            Array.isArray(record.cookies) &&
            Array.isArray(record.cookieKeys) &&
            Array.isArray(record.reportedCookieFindings)
        );
    }

    public getReport(engineState: EngineState): Report {
        const state = this.getState(engineState);
        const items = [
            {
                key: "grade",
                label: "Grade",
                value: state.grade,
            },
            {
                key: "score",
                label: "Score",
                value: state.score,
            },
            {
                key: "cookieCount",
                label: "Cookies Observed",
                value: state.cookies.length,
            },
        ];

        for (const [index, cookie] of [...state.cookies]
            .sort(
                (left, right) =>
                    left.name.localeCompare(right.name) || left.key.localeCompare(right.key),
            )
            .entries()) {
            items.push({
                key: `cookie_${index + 1}`,
                label: `Cookie ${index + 1}: ${cookie.name}`,
                value: this.formatCookieInventoryItem(cookie),
            });
        }

        return {
            plugin: this.name,
            label: "Security Headers",
            items,
        };
    }
}
