import { BasePlugin } from "../engine/BasePlugin.js";
import type { FindingCode, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type SoftHttpErrorPluginOptions = {
    auditOnlyStartUrl?: boolean;
    maxAnalyzedChars?: number;
    soft404Patterns?: RegExp[];
    soft500Patterns?: RegExp[];
};

type SoftHttpSignal = {
    code: FindingCode;
    label: "soft404" | "soft500";
    patterns: RegExp[];
};

const DEFAULT_SOFT_404_PATTERNS = [
    /\b404\b/i,
    /\bpage not found\b/i,
    /\bnot found\b/i,
    /\bpage introuvable\b/i,
    /\bcontenu introuvable\b/i,
    /\bpage inexistante\b/i,
    /\bpage requested could not be found\b/i,
    /\bdoes not exist\b/i,
    /\bno results found\b/i,
    /\bseite nicht gefunden\b/i,
    /\bnicht gefunden\b/i,
    /\bdiese seite existiert nicht\b/i,
    /\bpagina niet gevonden\b/i,
    /\bniet gevonden\b/i,
    /\bdeze pagina bestaat niet\b/i,
    /\bgeen resultaten gevonden\b/i,
];

const DEFAULT_SOFT_500_PATTERNS = [
    /\b500\b/i,
    /\binternal server error\b/i,
    /\bserver error\b/i,
    /\btemporary error\b/i,
    /\bservice unavailable\b/i,
    /\bapplication error\b/i,
    /\bune erreur est survenue\b/i,
    /\berreur interne du serveur\b/i,
    /\bincident technique\b/i,
    /\binterner serverfehler\b/i,
    /\bserverfehler\b/i,
    /\bein technischer fehler ist aufgetreten\b/i,
    /\bdienst nicht verfugb?ar\b/i,
    /\binterne serverfout\b/i,
    /\bserverfout\b/i,
    /\beer is een technische fout opgetreden\b/i,
    /\bdienst niet beschikbaar\b/i,
];

export class SoftHttpErrorPlugin extends BasePlugin implements IPlugin {
    name = "soft-http-error";
    phases: PluginPhase[] = ["process"];

    private readonly auditOnlyStartUrl: boolean;
    private readonly maxAnalyzedChars: number;
    private readonly soft404Patterns: RegExp[];
    private readonly soft500Patterns: RegExp[];

    constructor(options: SoftHttpErrorPluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? false;
        this.maxAnalyzedChars = options.maxAnalyzedChars ?? 4000;
        this.soft404Patterns = options.soft404Patterns ?? DEFAULT_SOFT_404_PATTERNS;
        this.soft500Patterns = options.soft500Patterns ?? DEFAULT_SOFT_500_PATTERNS;
    }

    applies(ctx: ResourceContext): boolean {
        if (!ctx.report.is_web) {
            return false;
        }

        if (this.auditOnlyStartUrl && ctx.depth !== 0) {
            return false;
        }

        return ctx.status !== undefined && ctx.status < 400;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const haystack = this.buildHaystack(ctx);
        if (!haystack) {
            this.register(ctx);
            return;
        }

        const detected = this.detectSignal(haystack);
        if (!detected) {
            this.register(ctx);
            return;
        }

        this.registerWarning(
            ctx,
            "network",
            detected.code,
            `The page looks like a ${detected.label.replace("soft", "soft ")} while returning HTTP ${ctx.status}.`,
            {
                status: ctx.status ?? null,
                finalUrl: ctx.finalUrl ?? ctx.url,
                matchedPattern: detected.matchedPattern.source,
                excerpt: this.createExcerpt(haystack, detected.matchedPattern),
            },
        );
    }

    private buildHaystack(ctx: ResourceContext): string {
        const parts = [
            ctx.report.meta_title,
            ctx.report.title,
            ctx.report.description,
            ctx.report.content,
        ]
            .filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
            )
            .map((value) => value.trim());

        if (parts.length === 0) {
            return "";
        }

        return parts.join("\n").slice(0, this.maxAnalyzedChars);
    }

    private detectSignal(
        haystack: string,
    ): { code: FindingCode; label: "soft404" | "soft500"; matchedPattern: RegExp } | null {
        const signals: SoftHttpSignal[] = [
            {
                code: "SOFT_404_DETECTED",
                label: "soft404",
                patterns: this.soft404Patterns,
            },
            {
                code: "SOFT_500_DETECTED",
                label: "soft500",
                patterns: this.soft500Patterns,
            },
        ];

        for (const signal of signals) {
            const matchedPattern = signal.patterns.find((pattern) => pattern.test(haystack));
            if (matchedPattern) {
                return {
                    code: signal.code,
                    label: signal.label,
                    matchedPattern,
                };
            }
        }

        return null;
    }

    private createExcerpt(haystack: string, pattern: RegExp): string | null {
        const match = pattern.exec(haystack);
        if (!match || typeof match.index !== "number") {
            return null;
        }

        const start = Math.max(0, match.index - 80);
        const end = Math.min(haystack.length, match.index + match[0].length + 80);
        return haystack.slice(start, end).replace(/\s+/g, " ").trim();
    }
}
