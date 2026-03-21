export class TimeUtils {

    static durationMs(startedAt: Date | string, endedAt: Date | string): number {
        const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
        const end = endedAt instanceof Date ? endedAt : new Date(endedAt);
        return Math.max(0, end.getTime() - start.getTime());
    }

    static formatHMS(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return [
            hours.toString().padStart(2, "0"),
            minutes.toString().padStart(2, "0"),
            seconds.toString().padStart(2, "0"),
        ].join(":");
    }

    static formatHuman(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts: string[] = [];

        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

        return parts.join(" ");
    }

    static formatShort(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
        }

        if (minutes > 0) {
            return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
        }

        return `${seconds}s`;
    }

    static formatMs(ms: number): string {
        if (ms < 1000) return `${ms}ms`;

        const seconds = ms / 1000;

        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }

        return this.formatShort(ms);
    }
}
