import dns from "node:dns/promises";
import net from "node:net";
import { BasePlugin } from "../engine/BasePlugin.js";
import { EngineState, IPlugin, PluginPhase, Report, ResourceContext } from "../engine/types.js";

type IpSupportPluginOptions = {
    auditOnlyStartUrl?: boolean;
    timeoutMs?: number;
    testConnectivity?: boolean;
};

type IpSupportResult = {
    host: string;
    port: number;
    ipv4: {
        supported: boolean;
        addresses: string[];
        reachable: boolean | null;
        error: string | null;
    };
    ipv6: {
        supported: boolean;
        addresses: string[];
        reachable: boolean | null;
        error: string | null;
    };
};

type IpSupportState = {
    ipV4Supported?: boolean;
    ipV6Supported?: boolean;
    ipV4Reachable?: boolean;
    ipV6Reachable?: boolean;
};

export class IpSupportPlugin extends BasePlugin implements IPlugin {
    name = "ip-support";
    phases: PluginPhase[] = ["afterGoto", "error"];

    private readonly auditOnlyStartUrl: boolean;
    private readonly timeoutMs: number;
    private readonly testConnectivity: boolean;

    constructor(options: IpSupportPluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? true;
        this.timeoutMs = options.timeoutMs ?? 5000;
        this.testConnectivity = options.testConnectivity ?? false;
    }

    applies(ctx: ResourceContext): boolean {
        return !this.auditOnlyStartUrl || ctx.depth === 0;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (this.auditOnlyStartUrl && ctx.depth !== 0) {
            return;
        }

        const targetUrl = ctx.finalUrl ?? ctx.url;

        if (phase === "error") {
            this.registerWarning(
                ctx,
                "network",
                "IP_SUPPORT_NOT_AUDITED",
                "IP support could not be audited because the start URL failed to load.",
                { targetUrl },
            );
            this.register(ctx);
            return;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(targetUrl);
        } catch {
            this.registerWarning(
                ctx,
                "network",
                "IP_SUPPORT_INVALID_URL",
                "IP support audit skipped because the URL is invalid.",
                { targetUrl },
            );
            this.register(ctx);
            return;
        }

        const host = parsedUrl.hostname;
        const port = parsedUrl.port
            ? Number(parsedUrl.port)
            : parsedUrl.protocol === "https:"
              ? 443
              : 80;

        const result: IpSupportResult = {
            host,
            port,
            ipv4: {
                supported: false,
                addresses: [],
                reachable: null,
                error: null,
            },
            ipv6: {
                supported: false,
                addresses: [],
                reachable: null,
                error: null,
            },
        };

        try {
            result.ipv4.addresses = await dns.resolve4(host);
            result.ipv4.supported = result.ipv4.addresses.length > 0;
        } catch (error) {
            result.ipv4.error = error instanceof Error ? error.message : String(error);
        }

        try {
            result.ipv6.addresses = await dns.resolve6(host);
            result.ipv6.supported = result.ipv6.addresses.length > 0;
        } catch (error) {
            result.ipv6.error = error instanceof Error ? error.message : String(error);
        }

        if (this.testConnectivity) {
            if (result.ipv4.supported && result.ipv4.addresses[0]) {
                result.ipv4.reachable = await this.testTcpConnection(
                    result.ipv4.addresses[0],
                    port,
                    4,
                );
            }

            if (result.ipv6.supported && result.ipv6.addresses[0]) {
                result.ipv6.reachable = await this.testTcpConnection(
                    result.ipv6.addresses[0],
                    port,
                    6,
                );
            }
        }

        this.registerInfo(
            ctx,
            "network",
            "IP_SUPPORT_DETAILS",
            "IP version support details collected for the start URL.",
            result,
        );

        if (!result.ipv4.supported) {
            this.registerWarning(
                ctx,
                "network",
                "IPV4_MISSING",
                "The hostname does not resolve to any IPv4 address.",
                result.ipv4,
            );
        }

        if (!result.ipv6.supported) {
            this.registerWarning(
                ctx,
                "network",
                "IPV6_MISSING",
                "The hostname does not resolve to any IPv6 address.",
                result.ipv6,
            );
        }

        if (this.testConnectivity) {
            if (result.ipv4.supported && result.ipv4.reachable === false) {
                this.registerWarning(
                    ctx,
                    "network",
                    "IPV4_UNREACHABLE",
                    "IPv4 is published in DNS but the TCP connection test failed.",
                    result.ipv4,
                );
            }

            if (result.ipv6.supported && result.ipv6.reachable === false) {
                this.registerWarning(
                    ctx,
                    "network",
                    "IPV6_UNREACHABLE",
                    "IPv6 is published in DNS but the TCP connection test failed.",
                    result.ipv6,
                );
            }
        }
        const state = this.getState(ctx.engineState);
        state.ipV4Supported = result.ipv4.supported;
        state.ipV6Supported = result.ipv6.supported;
        state.ipV4Reachable = result.ipv4.reachable ?? undefined;
        state.ipV6Reachable = result.ipv6.reachable ?? undefined;

        this.register(ctx);
    }

    private testTcpConnection(address: string, port: number, family: 4 | 6): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = net.connect({ host: address, port, family });

            const cleanup = () => {
                socket.removeAllListeners();
                socket.destroy();
            };

            socket.setTimeout(this.timeoutMs);

            socket.once("connect", () => {
                cleanup();
                resolve(true);
            });

            socket.once("timeout", () => {
                cleanup();
                resolve(false);
            });

            socket.once("error", () => {
                cleanup();
                resolve(false);
            });
        });
    }

    private getState(state: EngineState): IpSupportState {
        const existing = state.any[this.name];
        if (this.isIpSupportState(existing)) {
            return existing;
        }

        const created: IpSupportState = {};
        state.any[this.name] = created;
        return created;
    }

    private isIpSupportState(value: unknown): value is IpSupportState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const record = value as Record<string, unknown>;
        return (
            (typeof record.ipV4Supported === "boolean" ||
                typeof record.ipV4Supported === "undefined") &&
            (typeof record.ipV6Supported === "boolean" ||
                typeof record.ipV6Supported === "undefined") &&
            (typeof record.ipV4Reachable === "boolean" ||
                typeof record.ipV4Reachable === "undefined") &&
            (typeof record.ipV6Reachable === "boolean" ||
                typeof record.ipV6Reachable === "undefined")
        );
    }

    public getReport(engineState: EngineState): Report {
        const state = this.getState(engineState);
        const items = [];
        if (typeof state.ipV4Supported === "boolean") {
            items.push({
                key: "ipV4Supported",
                label: "IPv4 Supported",
                value: state.ipV4Supported,
            });
        }
        if (typeof state.ipV4Reachable === "boolean") {
            items.push({
                key: "ipV4Reachable",
                label: "IPv4 Reachable",
                value: state.ipV4Reachable,
            });
        }
        if (typeof state.ipV6Supported === "boolean") {
            items.push({
                key: "ipV6Supported",
                label: "IPv6 Supported",
                value: state.ipV6Supported,
            });
        }
        if (typeof state.ipV6Reachable === "boolean") {
            items.push({
                key: "ipV6Reachable",
                label: "IPv6 Reachable",
                value: state.ipV6Reachable,
            });
        }

        return {
            plugin: this.name,
            label: "Network / IP",
            items,
        };
    }
}
