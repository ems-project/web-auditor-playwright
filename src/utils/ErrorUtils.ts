export class ErrorUtils {
    static errorMessage(prefix: string, error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return `${prefix}: ${message}`;
    }
}
