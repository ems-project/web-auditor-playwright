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
}
