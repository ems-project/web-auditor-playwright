import type { PluginSummary, Report } from "./types.js";

function pad(value: string | number, length: number): string {
    return String(value).padEnd(length, " ");
}

export function printReports(reports: Report[]) {
    console.log("\n\n=== Audit reports ===\n");
    for (const reportIndex in reports) {
        const report = reports[reportIndex];
        if (report.items.length === 0) {
            continue;
        }
        console.log(` - ${report.label} (${report.plugin})`);
        const labelLength =
            report.items.reduce(
                (max, report) => (report.label.length > max ? report.label.length : max),
                0,
            ) + 1;
        for (const itemIndex in report.items) {
            const item = report.items[itemIndex];
            console.log(
                `   - ${item.label.padEnd(labelLength)} : ${typeof item.value === "boolean" ? (item.value ? "✔ yes" : "✖ no") : item.value}`,
            );
        }
    }
}

export function printPluginSummaryTable(summaries: PluginSummary[]): void {
    if (summaries.length === 0) {
        console.log("No plugin summaries.");
        return;
    }

    const headers = ["Plugin", "Treated", "Info", "Warnings", "Errors"];

    const rows = summaries.map((s) => [s.plugin, s.treatedUrls, s.infos, s.warnings, s.errors]);

    const colWidths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map((row) => String(row[i]).length)),
    );

    const buildRow = (row: (string | number)[]) =>
        "| " + row.map((cell, i) => pad(cell, colWidths[i])).join(" | ") + " |";

    const separator = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";

    console.log("\n=== Plugin Summary ===\n");

    console.log(separator);
    console.log(buildRow(headers));
    console.log(separator);

    for (const row of rows) {
        console.log(buildRow(row));
    }

    console.log(separator);
}
