import {
    FindingCategory,
    FindingCode,
    FindingData,
    FindingSeverity,
    PluginSummary,
    ResourceContext,
    ResourceReportLink,
} from "./types.js";

export abstract class BasePlugin {
    protected treatedUrls = 0;
    protected infos = 0;
    protected warnings = 0;
    protected errors = 0;
    protected abstract name: string;

    includeInSummary(): boolean {
        return true;
    }

    isAuditPlugin(): boolean {
        return true;
    }

    getSummary(): PluginSummary {
        return {
            plugin: (this as unknown as { name: string }).name,
            treatedUrls: this.treatedUrls,
            infos: this.infos,
            warnings: this.warnings,
            errors: this.errors,
        };
    }

    protected register(ctx: ResourceContext): void {
        this.addAuditor(ctx);
    }

    protected registerInfo(
        ctx: ResourceContext,
        category: FindingCategory,
        code: FindingCode,
        message: string,
        data?: FindingData,
    ): void {
        this.registerFinding("info", category, ctx, code, message, data);
    }

    protected registerWarning(
        ctx: ResourceContext,
        category: FindingCategory,
        code: FindingCode,
        message: string,
        data?: FindingData,
    ): void {
        this.registerFinding("warning", category, ctx, code, message, data);
    }

    protected registerError(
        ctx: ResourceContext,
        category: FindingCategory,
        code: FindingCode,
        message: string,
        data?: FindingData,
    ): void {
        this.registerFinding("error", category, ctx, code, message, data);
    }

    protected registerFinding(
        severity: FindingSeverity,
        category: FindingCategory,
        ctx: ResourceContext,
        code: FindingCode,
        message: string,
        data?: FindingData,
    ) {
        this.pushFinding(severity, category, ctx, code, message, data);
    }

    protected registerA11yFinding(
        severity: FindingSeverity,
        category: FindingCategory,
        ctx: ResourceContext,
        code: string,
        message: string,
        data?: FindingData,
    ) {
        this.pushFinding(severity, category, ctx, code, message, data);
    }

    private pushFinding(
        severity: FindingSeverity,
        category: FindingCategory,
        ctx: ResourceContext,
        code: string,
        message: string,
        data?: FindingData,
    ) {
        this.addAuditor(ctx);
        ctx.findings.push({
            plugin: this.name,
            category,
            type: severity,
            code,
            message,
            data,
            url: ctx.url,
        });
        switch (severity) {
            case "info":
                this.infos += 1;
                break;
            case "warning":
                this.warnings += 1;
                break;
            case "error":
                this.errors += 1;
                break;
        }
    }

    protected mergeLinks(
        existing: ResourceReportLink[],
        incoming: ResourceReportLink[],
    ): ResourceReportLink[] {
        const map = new Map<string, ResourceReportLink>();

        for (const link of existing) {
            map.set(`${link.type}|${link.url}`, link);
        }
        for (const link of incoming) {
            map.set(`${link.type}|${link.url}`, link);
        }

        return [...map.values()];
    }

    private addAuditor(ctx: ResourceContext) {
        ctx.audited ||= this.isAuditPlugin();
        ctx.auditors ??= [];
        if (ctx.auditors.includes(this.name)) {
            return;
        }
        ctx.auditors.push(this.name);
        this.treatedUrls += 1;
    }
}
