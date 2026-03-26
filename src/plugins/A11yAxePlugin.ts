import { AxeBuilder } from "@axe-core/playwright";

import { BasePlugin } from "../engine/BasePlugin.js";
import {
    IPlugin,
    PluginPhase,
    ResourceContext,
    ResourceReportA11yAxeNode,
} from "../engine/types.js";

type A11yAxePluginOptions = {
    relevantTags: string[];
};

export class A11yAxePlugin extends BasePlugin implements IPlugin {
    name = "a11y-axe";
    phases: PluginPhase[] = ["process", "error"];
    private relevantTags: string[];

    constructor(private readonly options: A11yAxePluginOptions) {
        super();
        this.relevantTags = options.relevantTags ?? null;
    }

    applies(ctx: ResourceContext): boolean {
        return undefined !== ctx.mime && ctx.mime.includes("text/html");
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const result = await new AxeBuilder({ page: ctx.page }).analyze();

        for (const violation of result.violations ?? []) {
            if (!violation.tags.some((tag) => this.relevantTags.includes(tag))) {
                continue;
            }

            const nodes: ResourceReportA11yAxeNode[] = [];
            for (const node of violation.nodes ?? []) {
                nodes.push({
                    impact: node.impact,
                    html: node.html,
                    failure_summary: node.failureSummary,
                    xpath: node.xpath,
                    target: Array.isArray(node.target) ? node.target.join(", ") : null,
                });
            }
            const message = `${violation.help} (${violation.impact ?? "unknown"})`;
            this.registerA11yFinding("error", "a11y", ctx, violation.id, message, {
                description: violation.description,
                help: violation.help,
                help_url: violation.helpUrl,
                id: violation.id,
                impact: violation.impact,
                nodes,
                tags: violation.tags,
                wcag_criteria: this.extractWcagCriteria(violation.tags),
                en301549_criteria: this.extractEn301549Criteria(violation.tags),
            });
        }

        this.register(ctx);
    }

    private extractWcagCriteria(tags: string[]): string[] {
        return tags.map(this.formatWcagCriterion).filter((v): v is string => v !== null);
    }

    private formatWcagCriterion(tag: string): string | null {
        const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
        if (!m) return null;
        return `${m[1]}.${m[2]}.${m[3]}`;
    }

    private extractEn301549Criteria(tags: string[]): string[] {
        return tags.map(this.formatEn301549Criterion).filter((v): v is string => v !== null);
    }

    private formatEn301549Criterion(tag: string): string | null {
        const m = /^EN-(\d+(?:\.\d+)+)$/.exec(tag);
        if (!m) return null;
        return m[1];
    }
}
