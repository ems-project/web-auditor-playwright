import tls from "node:tls";
import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";
import { TextUtils } from "../utils/TextUtils.js";

type TlsCertificatePluginOptions = {
    auditOnlyStartUrl?: boolean;
    warnIfExpiresInDays?: number;
    timeoutMs?: number;
    minAcceptedTlsVersion?: "TLSv1.2" | "TLSv1.3";
    minScoreForError?: number;
};

type TlsCertInfo = {
    host: string;
    port: number;
    servername: string;
    protocol: string | null;
    cipherName: string | null;
    cipherVersion: string | null;
    authorized: boolean;
    authorizationError: string | null;
    validFrom: string | null;
    validTo: string | null;
    validToIso: string | null;
    daysRemaining: number | null;
    expired: boolean;
    subject: Record<string, unknown> | null;
    issuer: Record<string, unknown> | null;
    subjectAltName: string | null;
    serialNumber: string | null;
    fingerprint: string | null;
    fingerprint256: string | null;
    selfSigned: boolean;
    chainDepth: number;
    score: number;
    grade: string;
    checks: {
        https: boolean;
        authorized: boolean;
        expired: boolean;
        expiresSoon: boolean;
        selfSigned: boolean;
        hasSan: boolean;
        tlsVersionOk: boolean;
        weakCipher: boolean;
        chainTooShort: boolean;
    };
};

export class TlsCertificatePlugin extends BasePlugin implements IPlugin {
    name = "tls-certificate";
    phases: PluginPhase[] = ["afterGoto", "error"];

    private readonly auditOnlyStartUrl: boolean;
    private readonly warnIfExpiresInDays: number;
    private readonly timeoutMs: number;
    private readonly minAcceptedTlsVersion: "TLSv1.2" | "TLSv1.3";
    private readonly minScoreForError: number;

    constructor(options: TlsCertificatePluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? true;
        this.warnIfExpiresInDays = options.warnIfExpiresInDays ?? 30;
        this.timeoutMs = options.timeoutMs ?? 10000;
        this.minAcceptedTlsVersion = options.minAcceptedTlsVersion ?? "TLSv1.2";
        this.minScoreForError = options.minScoreForError ?? 50;
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
                "TLS_CERTIFICATE_NOT_AUDITED",
                "TLS certificate could not be audited because the start URL failed to load.",
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
                "TLS_CERTIFICATE_INVALID_URL",
                "TLS certificate audit skipped because the URL is invalid.",
                { targetUrl },
            );
            this.register(ctx);
            return;
        }

        if (parsedUrl.protocol !== "https:") {
            this.registerInfo(
                ctx,
                "TLS_CERTIFICATE_NOT_APPLICABLE",
                "TLS certificate audit skipped because the URL is not HTTPS.",
                { targetUrl, protocol: parsedUrl.protocol },
            );
            this.register(ctx);
            return;
        }

        const host = parsedUrl.hostname;
        const port = parsedUrl.port ? Number(parsedUrl.port) : 443;
        const servername = host;

        try {
            const cert = await this.inspectCertificate(host, port, servername);
            ctx.engineState.tlsGrade = cert.grade;
            ctx.engineState.tlsScore = cert.score;
            ctx.engineState.tlsValidFrom = cert.validFrom ?? undefined;
            ctx.engineState.tlsValidTo = cert.validTo ?? undefined;
            ctx.engineState.tlsDaysRemaining = cert.daysRemaining ?? undefined;

            this.registerInfo(
                ctx,
                "TLS_CERTIFICATE_DETAILS",
                "TLS certificate details collected for the start URL.",
                cert,
            );

            this.registerScoreFinding(ctx, cert);
            this.registerCheckFindings(ctx, cert);
        } catch (error) {
            this.registerError(
                ctx,
                "TLS_CERTIFICATE_AUDIT_FAILED",
                "TLS certificate audit failed.",
                {
                    targetUrl,
                    error: error instanceof Error ? error.message : String(error),
                },
            );
        }

        this.register(ctx);
    }

    private registerScoreFinding(ctx: ResourceContext, cert: TlsCertInfo): void {
        const summary = this.buildSummary(cert);

        const payload = {
            score: cert.score,
            grade: cert.grade,
            summary,
            host: cert.host,
            protocol: cert.protocol,
            authorized: cert.authorized,
            selfSigned: cert.selfSigned,
            expired: cert.expired,
            daysRemaining: cert.daysRemaining,
            chainDepth: cert.chainDepth,
            cipherName: cert.cipherName,
            checks: cert.checks,
        };

        if (cert.score < this.minScoreForError || cert.expired || !cert.authorized) {
            this.registerError(
                ctx,
                "TLS_CERTIFICATE_SCORE",
                `TLS certificate score: ${cert.grade} (${cert.score}/100). ${summary}`,
                payload,
            );
            return;
        }

        if (
            cert.selfSigned ||
            cert.checks.expiresSoon ||
            !cert.checks.tlsVersionOk ||
            cert.checks.weakCipher ||
            cert.checks.chainTooShort ||
            !cert.checks.hasSan
        ) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_SCORE",
                `TLS certificate score: ${cert.grade} (${cert.score}/100). ${summary}`,
                payload,
            );
            return;
        }

        this.registerInfo(
            ctx,
            "TLS_CERTIFICATE_SCORE",
            `TLS certificate score: ${cert.grade} (${cert.score}/100). ${summary}`,
            payload,
        );
    }

    private registerCheckFindings(ctx: ResourceContext, cert: TlsCertInfo): void {
        if (!cert.authorized) {
            this.registerError(
                ctx,
                "TLS_CERTIFICATE_INVALID",
                `The TLS certificate is not trusted by Node/OpenSSL: ${cert.authorizationError ?? "unknown error"}.`,
                cert,
            );
        }

        if (cert.expired) {
            this.registerError(
                ctx,
                "TLS_CERTIFICATE_EXPIRED",
                "The TLS certificate is expired.",
                cert,
            );
        } else if (cert.checks.expiresSoon && cert.daysRemaining !== null) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_EXPIRING_SOON",
                `The TLS certificate expires in ${cert.daysRemaining} day(s).`,
                cert,
            );
        }

        if (cert.selfSigned) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_SELF_SIGNED",
                "The TLS certificate appears to be self-signed.",
                cert,
            );
        }

        if (!cert.checks.hasSan) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_NO_SAN",
                "The TLS certificate does not expose a Subject Alternative Name (SAN).",
                cert,
            );
        }

        if (!cert.checks.tlsVersionOk) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_OLD_TLS_VERSION",
                `The negotiated TLS version (${cert.protocol ?? "unknown"}) is below the expected minimum (${this.minAcceptedTlsVersion}).`,
                cert,
            );
        }

        if (cert.checks.weakCipher) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_WEAK_CIPHER",
                `The negotiated cipher looks weak or legacy: ${cert.cipherName ?? "unknown"}.`,
                cert,
            );
        }

        if (cert.checks.chainTooShort) {
            this.registerWarning(
                ctx,
                "TLS_CERTIFICATE_SHORT_CHAIN",
                `The certificate chain looks unusually short (depth=${cert.chainDepth}).`,
                cert,
            );
        }
    }

    private inspectCertificate(
        host: string,
        port: number,
        servername: string,
    ): Promise<TlsCertInfo> {
        return new Promise((resolve, reject) => {
            const socket = tls.connect({
                host,
                port,
                servername,
                rejectUnauthorized: false,
            });

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const onTimeout = () => {
                cleanup();
                socket.destroy();
                reject(new Error(`TLS connection timed out after ${this.timeoutMs} ms`));
            };

            const onSecureConnect = () => {
                try {
                    const peer = socket.getPeerCertificate(true);
                    const protocol = socket.getProtocol();
                    const cipher = socket.getCipher();

                    const validToIso = this.toIsoDate(peer?.valid_to);
                    const daysRemaining =
                        validToIso !== null
                            ? Math.ceil(
                                  (new Date(validToIso).getTime() - Date.now()) /
                                      (1000 * 60 * 60 * 24),
                              )
                            : null;

                    const expired = daysRemaining !== null ? daysRemaining < 0 : false;
                    const selfSigned = this.isSelfSigned(peer);
                    const chainDepth = this.getChainDepth(peer);
                    const hasSan =
                        typeof peer?.subjectaltname === "string" &&
                        peer.subjectaltname.trim().length > 0;

                    const tlsVersionOk = this.isTlsVersionOk(
                        typeof protocol === "string" ? protocol : null,
                    );

                    const weakCipher = this.isWeakCipher(cipher?.name ?? null);
                    const chainTooShort = chainDepth <= 1;
                    const expiresSoon =
                        !expired &&
                        daysRemaining !== null &&
                        daysRemaining <= this.warnIfExpiresInDays;

                    const checks = {
                        https: true,
                        authorized: socket.authorized,
                        expired,
                        expiresSoon,
                        selfSigned,
                        hasSan,
                        tlsVersionOk,
                        weakCipher,
                        chainTooShort,
                    };

                    const score = this.computeScore(checks);
                    const grade = this.computeGrade(score);

                    const result: TlsCertInfo = {
                        host,
                        port,
                        servername,
                        protocol: typeof protocol === "string" ? protocol : null,
                        cipherName: cipher?.name ?? null,
                        cipherVersion: cipher?.version ?? null,
                        authorized: socket.authorized,
                        authorizationError: TextUtils.asString(socket.authorizationError ?? null),
                        validFrom: peer?.valid_from ?? null,
                        validTo: peer?.valid_to ?? null,
                        validToIso,
                        daysRemaining,
                        expired,
                        subject: this.toPlainRecord(peer?.subject),
                        issuer: this.toPlainRecord(peer?.issuer),
                        subjectAltName: peer?.subjectaltname ?? null,
                        serialNumber: peer?.serialNumber ?? null,
                        fingerprint: peer?.fingerprint ?? null,
                        fingerprint256: peer?.fingerprint256 ?? null,
                        selfSigned,
                        chainDepth,
                        score,
                        grade,
                        checks,
                    };

                    cleanup();
                    socket.end();
                    resolve(result);
                } catch (error) {
                    cleanup();
                    socket.destroy();
                    reject(error);
                }
            };

            const cleanup = () => {
                socket.off("error", onError);
                socket.off("timeout", onTimeout);
                socket.off("secureConnect", onSecureConnect);
            };

            socket.setTimeout(this.timeoutMs);
            socket.once("error", onError);
            socket.once("timeout", onTimeout);
            socket.once("secureConnect", onSecureConnect);
        });
    }

    private computeScore(checks: TlsCertInfo["checks"]): number {
        let score = 100;

        if (!checks.authorized) {
            score -= 45;
        }
        if (checks.expired) {
            score -= 40;
        }
        if (checks.expiresSoon) {
            score -= 10;
        }
        if (checks.selfSigned) {
            score -= 25;
        }
        if (!checks.hasSan) {
            score -= 10;
        }
        if (!checks.tlsVersionOk) {
            score -= 15;
        }
        if (checks.weakCipher) {
            score -= 15;
        }
        if (checks.chainTooShort) {
            score -= 5;
        }

        return Math.max(0, Math.min(100, score));
    }

    private computeGrade(score: number): string {
        if (score >= 97) return "A+";
        if (score >= 93) return "A";
        if (score >= 90) return "A-";
        if (score >= 85) return "B+";
        if (score >= 80) return "B";
        if (score >= 75) return "B-";
        if (score >= 70) return "C+";
        if (score >= 65) return "C";
        if (score >= 60) return "C-";
        if (score >= 55) return "D+";
        if (score >= 50) return "D";
        return "F";
    }

    private buildSummary(cert: TlsCertInfo): string {
        const parts = [
            `TLS ${cert.protocol ?? "unknown"}`,
            cert.authorized ? "trusted" : "untrusted",
        ];

        if (cert.daysRemaining !== null) {
            parts.push(
                cert.expired ? "certificate expired" : `expires in ${cert.daysRemaining} day(s)`,
            );
        }

        if (cert.selfSigned) {
            parts.push("self-signed");
        }

        if (!cert.checks.hasSan) {
            parts.push("missing SAN");
        }

        if (!cert.checks.tlsVersionOk) {
            parts.push(`old TLS version (min expected: ${this.minAcceptedTlsVersion})`);
        }

        if (cert.cipherName) {
            parts.push(`cipher ${cert.cipherName}`);
        }

        if (cert.checks.weakCipher) {
            parts.push("weak cipher");
        }

        return `Start URL certificate: ${parts.join(", ")}.`;
    }

    private isTlsVersionOk(protocol: string | null): boolean {
        if (!protocol) {
            return false;
        }

        const order: Record<string, number> = {
            SSLv2: 0,
            SSLv3: 1,
            TLSv1: 2,
            "TLSv1.1": 3,
            "TLSv1.2": 4,
            "TLSv1.3": 5,
        };

        return (order[protocol] ?? -1) >= order[this.minAcceptedTlsVersion];
    }

    private isWeakCipher(cipherName: string | null): boolean {
        if (!cipherName) {
            return true;
        }

        const upper = cipherName.toUpperCase();

        return ["RC4", "3DES", "DES", "MD5", "NULL", "ANON", "EXPORT", "CBC_SHA"].some((token) =>
            upper.includes(token),
        );
    }

    private toIsoDate(value: unknown): string | null {
        if (typeof value !== "string" || value.trim().length === 0) {
            return null;
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    private toPlainRecord(value: unknown): Record<string, unknown> | null {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }

        return { ...(value as Record<string, unknown>) };
    }

    private isSelfSigned(peer: tls.PeerCertificate): boolean {
        const subject = this.toPlainRecord(peer?.subject);
        const issuer = this.toPlainRecord(peer?.issuer);

        if (!subject || !issuer) {
            return false;
        }

        return JSON.stringify(subject) === JSON.stringify(issuer);
    }

    private getChainDepth(peer: tls.PeerCertificate): number {
        let depth = 0;
        let current: tls.DetailedPeerCertificate | tls.PeerCertificate | undefined = peer;
        const visited = new Set<string>();

        while (current && typeof current === "object") {
            depth += 1;

            const fingerprint =
                "fingerprint256" in current && typeof current.fingerprint256 === "string"
                    ? current.fingerprint256
                    : `depth-${depth}`;

            if (visited.has(fingerprint)) {
                break;
            }
            visited.add(fingerprint);

            if (
                !("issuerCertificate" in current) ||
                !current.issuerCertificate ||
                current.issuerCertificate === current
            ) {
                break;
            }

            current = current.issuerCertificate;
        }

        return depth;
    }
}
