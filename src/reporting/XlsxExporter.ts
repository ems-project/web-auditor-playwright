import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs/promises";
import { Report } from "../engine/types.js";

export interface AuditConsoleReport {
    reports: Report[];
    plugins: PluginSummary[];
    issues: IssueEntry[];
    inventory: InventoryEntry[];
}

export interface PluginSummary {
    plugin: string;
    treatedUrls?: number;
    infos?: number;
    warnings?: number;
    errors?: number;
    [key: string]: unknown;
}

export interface IssueEntry {
    plugin: string;
    type: "info" | "warning" | "error" | string;
    category: string;
    code: string;
    message: string;
    url?: string;
    data?: unknown;
    [key: string]: unknown;
}

export interface InventoryEntry {
    depth?: number;
    mime?: string;
    status?: number;
    url: string;
    [key: string]: unknown;
}

export interface XlsxExporterOptions {
    outputPath: string;
    creator?: string;
    reportsSheetName?: string;
    pluginsSheetName?: string;
    issuesSheetName?: string;
    inventorySheetName?: string;
}

export class XlsxExporter {
    private readonly options: Required<XlsxExporterOptions>;

    public constructor(options: XlsxExporterOptions) {
        this.options = {
            outputPath: options.outputPath,
            creator: options.creator ?? "web-auditor-playwright",
            reportsSheetName: options.reportsSheetName ?? "reports",
            pluginsSheetName: options.pluginsSheetName ?? "plugins",
            issuesSheetName: options.issuesSheetName ?? "issues",
            inventorySheetName: options.inventorySheetName ?? "inventory",
        };
    }

    public async export(report: AuditConsoleReport): Promise<void> {
        await fs.mkdir(path.dirname(this.options.outputPath), { recursive: true });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = this.options.creator;
        workbook.created = new Date();
        workbook.modified = new Date();
        workbook.title = "Web Auditor report";
        workbook.subject = "Export of console JSON report";

        this.addReportsSheet(workbook, report.reports);
        this.addPluginsSheet(workbook, report.plugins);
        this.addIssuesSheet(workbook, report.issues);
        this.addInventorySheet(workbook, report.inventory);

        await workbook.xlsx.writeFile(this.options.outputPath);
    }

    private addReportsSheet(workbook: ExcelJS.Workbook, reports: Report[]): void {
        const ws = workbook.addWorksheet(this.safeSheetName(this.options.reportsSheetName));
        ws.columns = [
            { header: "plugin", key: "plugin", width: 28 },
            { header: "key", key: "key", width: 28 },
            { header: "value", key: "value", width: 60 },
        ];

        for (const report of reports) {
            for (const item of report.items) {
                ws.addRow({
                    plugin: report.plugin,
                    key: item.key,
                    value: this.stringifyCellValue(item.value),
                });
            }
        }

        this.styleHeader(ws);
        this.decorateSheet(ws);
    }

    private addPluginsSheet(workbook: ExcelJS.Workbook, plugins: PluginSummary[]): void {
        const ws = workbook.addWorksheet(this.safeSheetName(this.options.pluginsSheetName));

        const rows = plugins.map((plugin) => ({
            plugin: this.stringifyCellValue(plugin.plugin),
            treatedUrls: this.toNumberOrBlank(plugin.treatedUrls),
            infos: this.toNumberOrBlank(plugin.infos),
            warnings: this.toNumberOrBlank(plugin.warnings),
            errors: this.toNumberOrBlank(plugin.errors),
            extra: this.stringifyExtraObject(plugin, [
                "plugin",
                "treatedUrls",
                "infos",
                "warnings",
                "errors",
            ]),
        }));

        ws.columns = [
            { header: "plugin", key: "plugin", width: 28 },
            { header: "treatedUrls", key: "treatedUrls", width: 12 },
            { header: "infos", key: "infos", width: 10 },
            { header: "warnings", key: "warnings", width: 10 },
            { header: "errors", key: "errors", width: 10 },
            { header: "extra", key: "extra", width: 50 },
        ];

        rows.forEach((row) => ws.addRow(row));

        this.styleHeader(ws);
        this.decorateSheet(ws);
        this.applyCountHighlight(ws, ["warnings", "errors"]);
    }

    private addIssuesSheet(workbook: ExcelJS.Workbook, issues: IssueEntry[]): void {
        const ws = workbook.addWorksheet(this.safeSheetName(this.options.issuesSheetName));

        ws.columns = [
            { header: "plugin", key: "plugin", width: 24 },
            { header: "type", key: "type", width: 10 },
            { header: "category", key: "category", width: 10 },
            { header: "code", key: "code", width: 34 },
            { header: "message", key: "message", width: 70 },
            { header: "url", key: "url", width: 70 },
            { header: "data", key: "data", width: 80 },
        ];

        for (const issue of issues) {
            const row = ws.addRow({
                plugin: issue.plugin,
                type: issue.type,
                category: issue.category,
                code: issue.code,
                message: issue.message,
                url: issue.url ?? "",
                data: issue.data == null ? "" : JSON.stringify(issue.data, null, 2),
            });

            const urlCell = row.getCell("url");
            if (issue.url) {
                urlCell.value = { text: issue.url, hyperlink: issue.url };
                urlCell.font = { color: { argb: "FF0563C1" }, underline: true };
            }
        }

        this.styleHeader(ws);
        this.decorateSheet(ws);
        this.applyIssueTypeFormatting(ws, "type");
    }

    private addInventorySheet(workbook: ExcelJS.Workbook, inventory: InventoryEntry[]): void {
        const ws = workbook.addWorksheet(this.safeSheetName(this.options.inventorySheetName));

        ws.columns = [
            { header: "depth", key: "depth", width: 10 },
            { header: "mime", key: "mime", width: 30 },
            { header: "status", key: "status", width: 10 },
            { header: "url", key: "url", width: 80 },
            { header: "extra", key: "extra", width: 40 },
        ];

        for (const entry of inventory) {
            const row = ws.addRow({
                depth: this.toNumberOrBlank(entry.depth),
                mime: entry.mime ?? "",
                status: this.toNumberOrBlank(entry.status),
                url: entry.url,
                extra: this.stringifyExtraObject(entry, ["depth", "mime", "status", "url"]),
            });

            const urlCell = row.getCell("url");
            urlCell.value = { text: entry.url, hyperlink: entry.url };
            urlCell.font = { color: { argb: "FF0563C1" }, underline: true };
        }

        this.styleHeader(ws);
        this.decorateSheet(ws);
        this.applyStatusFormatting(ws, "status");
    }

    private styleHeader(ws: ExcelJS.Worksheet): void {
        const header = ws.getRow(1);
        header.font = { bold: true, color: { argb: "FFFFFFFF" } };
        header.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1F4E78" },
        };
        header.alignment = { vertical: "middle", horizontal: "left" };

        for (let col = 1; col <= ws.columnCount; col++) {
            header.getCell(col).border = {
                bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
            };
        }
    }

    private decorateSheet(ws: ExcelJS.Worksheet): void {
        ws.views = [{ state: "frozen", ySplit: 1 }];
        if (ws.columnCount > 0) {
            ws.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: ws.columnCount },
            };
        }

        for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
            const row = ws.getRow(rowIndex);
            row.alignment = { vertical: "top", wrapText: true };
        }
    }

    private applyIssueTypeFormatting(ws: ExcelJS.Worksheet, key: string): void {
        const colIndex = this.getColumnIndexByKey(ws, key);
        if (colIndex === -1) {
            return;
        }

        for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
            const cell = ws.getRow(rowIndex).getCell(colIndex);
            const value = String(cell.value ?? "").toLowerCase();

            if (value === "error") {
                cell.font = { bold: true, color: { argb: "FF9C0006" } };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFFC7CE" },
                };
            } else if (value === "warning") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFFEB9C" },
                };
            } else if (value === "info") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFDDEBF7" },
                };
            }
        }
    }

    private applyStatusFormatting(ws: ExcelJS.Worksheet, key: string): void {
        const colIndex = this.getColumnIndexByKey(ws, key);
        if (colIndex === -1) {
            return;
        }

        for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
            const cell = ws.getRow(rowIndex).getCell(colIndex);
            const status = Number(cell.value);

            if (Number.isNaN(status)) {
                continue;
            }

            if (status >= 500) {
                cell.font = { bold: true, color: { argb: "FF9C0006" } };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFFC7CE" },
                };
            } else if (status >= 400) {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFFEB9C" },
                };
            }
        }
    }

    private applyCountHighlight(ws: ExcelJS.Worksheet, keys: string[]): void {
        for (const key of keys) {
            const colIndex = this.getColumnIndexByKey(ws, key);
            if (colIndex === -1) {
                continue;
            }

            for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
                const cell = ws.getRow(rowIndex).getCell(colIndex);
                const value = Number(cell.value);
                if (Number.isNaN(value) || value <= 0) {
                    continue;
                }

                cell.font = { bold: true };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: key === "errors" ? "FFFFC7CE" : "FFFFEB9C" },
                };
            }
        }
    }

    private getColumnIndexByKey(ws: ExcelJS.Worksheet, key: string): number {
        for (let i = 1; i <= ws.columnCount; i++) {
            if (ws.getColumn(i).key === key) {
                return i;
            }
        }
        return -1;
    }

    private stringifyExtraObject(value: Record<string, unknown>, excludedKeys: string[]): string {
        const clone: Record<string, unknown> = {};

        for (const [key, item] of Object.entries(value)) {
            if (!excludedKeys.includes(key)) {
                clone[key] = item;
            }
        }

        return Object.keys(clone).length === 0 ? "" : JSON.stringify(clone, null, 2);
    }

    private stringifyCellValue(value: unknown): string | number | boolean {
        if (value == null) {
            return "";
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return value;
        }
        return JSON.stringify(value, null, 2);
    }

    private toNumberOrBlank(value: unknown): number | string {
        return typeof value === "number" ? value : "";
    }

    private safeSheetName(name: string): string {
        return name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
    }
}
