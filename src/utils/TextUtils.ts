import { ResourceReportLink } from "../engine/types.js";

export class TextUtils {
    static normalizeText(text: string, maxExtractedChars: number = 0): string {
        const normalized = text.replace(/\s+/g, " ").trim();
        return normalized.length > maxExtractedChars && maxExtractedChars > 0
            ? normalized.slice(0, maxExtractedChars)
            : normalized;
    }

    static extractLinks(text: string, limit: number, type: string): ResourceReportLink[] {
        const found = text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? [];
        return [...new Set(found)].slice(0, limit).map((url) => ({
            type: type,
            url,
            text: url,
        }));
    }

    static firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
        for (const value of values) {
            if (typeof value === "string" && value.trim().length > 0) {
                return value.trim();
            }
        }
        return null;
    }

    static asString(value: unknown): string | null {
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        if (Array.isArray(value)) {
            const parts = value
                .map((item) => (typeof item === "string" ? item.trim() : ""))
                .filter((item) => item.length > 0);

            return parts.length > 0 ? parts.join(" ") : null;
        }

        return null;
    }

    static statusLabel(value: boolean | null | undefined): string {
        if (value === true) return "✔ yes    ";
        if (value === false) return "✖ no     ";
        return "~ unknown";
    }

    static parseRegexList(env?: string): RegExp[] {
        return (
            env
                ?.split(",")
                .map((s) => s.trim())
                .filter((p) => p.length > 0)
                .map((pattern) => new RegExp(pattern)) ?? []
        );
    }

    static parseHttpHeadersJson(env?: string): Record<string, string> | undefined {
        const trimmed = env?.trim();
        if (!trimmed) {
            return undefined;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(
                `Invalid PLAYWRIGHT_EXTRA_HTTP_HEADERS JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("PLAYWRIGHT_EXTRA_HTTP_HEADERS must be a JSON object");
        }

        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(parsed)) {
            const headerName = name.trim();
            if (!headerName) {
                throw new Error("PLAYWRIGHT_EXTRA_HTTP_HEADERS contains an empty header name");
            }
            if (typeof value !== "string") {
                throw new Error(
                    `PLAYWRIGHT_EXTRA_HTTP_HEADERS value for "${headerName}" must be a string`,
                );
            }
            headers[headerName] = value;
        }

        return Object.keys(headers).length > 0 ? headers : undefined;
    }
}
