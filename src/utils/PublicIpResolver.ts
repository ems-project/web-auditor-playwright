import net from "node:net";

export type PublicIpResolverOptions = {
    ipv4Url: string;
    ipv6Url: string;
    timeoutMs: number;
};

export type PublicIpAddresses = {
    ipv4: string | null;
    ipv6: string | null;
};

export async function fetchPublicIpAddresses(
    options: PublicIpResolverOptions,
): Promise<PublicIpAddresses> {
    const [ipv4, ipv6] = await Promise.all([
        fetchSinglePublicIp(options.ipv4Url, options.timeoutMs, 4),
        fetchSinglePublicIp(options.ipv6Url, options.timeoutMs, 6),
    ]);

    return { ipv4, ipv6 };
}

export function normalizePublicIpResponse(raw: string, family: 4 | 6): string | null {
    const candidate = raw.trim();
    if (!candidate) {
        return null;
    }

    return net.isIP(candidate) === family ? candidate : null;
}

async function fetchSinglePublicIp(
    url: string,
    timeoutMs: number,
    family: 4 | 6,
): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                accept: "text/plain",
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            return null;
        }

        const body = await response.text();
        return normalizePublicIpResponse(body, family);
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
