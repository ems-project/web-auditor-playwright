import { FindingData, FindingSeverity, PluginSummary, ResourceContext } from "./types.js";

export abstract class BasePlugin {
    protected auditedUrls = 0;
    protected infos = 0;
    protected warnings = 0;
    protected errors = 0;
    protected abstract name: string;

    includeInSummary(): boolean {
        return true;
    }

    getSummary(): PluginSummary {
        return {
            plugin: (this as unknown as { name: string }).name,
            auditedUrls: this.auditedUrls,
            infos: this.infos,
            warnings: this.warnings,
            errors: this.errors,
        };
    }

    protected register(ctx: ResourceContext): void {
        ctx.audited = true;
        this.auditedUrls += 1;
    }

    protected registerInfo(ctx: ResourceContext, code: string, message: string): void {
        this.registerFinding("info", ctx, code, message);
    }

    protected registerWarning(ctx: ResourceContext, code: string, message: string): void {
        this.registerFinding("warning", ctx, code, message);
    }

    protected registerError(ctx: ResourceContext, code: string, message: string): void {
        this.registerFinding("error", ctx, code, message);
    }

    protected registerFinding(
        severity: FindingSeverity,
        ctx: ResourceContext,
        code: string,
        message: string,
        data?: FindingData,
    ) {
        ctx.findings.push({
            plugin: this.name,
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
}
