import readline from "node:readline";

type StopCallbacks = {
    onConfirmedStop: () => void;
    isStopAlreadyRequested?: () => boolean;
};

export class GracefulStopController {
    private readonly stdin = process.stdin;
    private listening = false;
    private awaitingConfirmation = false;
    private wasRawMode = false;

    constructor(private readonly callbacks: StopCallbacks) {}

    start(): void {
        if (!this.stdin.isTTY || this.listening) {
            return;
        }

        this.listening = true;
        this.wasRawMode = Boolean((this.stdin as NodeJS.ReadStream).isRaw);

        readline.emitKeypressEvents(this.stdin);
        this.stdin.setRawMode?.(true);
        this.stdin.resume();

        console.log("Press the 's' key to graceful stop the audit...");
        this.stdin.on("keypress", this.onKeypress);
    }

    stop(): void {
        if (!this.listening) {
            return;
        }

        this.stdin.off("keypress", this.onKeypress);

        if (this.stdin.isTTY) {
            this.stdin.setRawMode?.(false);
        }

        this.stdin.pause();
        this.listening = false;
        this.awaitingConfirmation = false;
    }

    private readonly onKeypress = (_str: string, key: readline.Key): void => {
        if (key.sequence === "\u0003") {
            this.stop();
            process.kill(process.pid, "SIGINT");
            return;
        }

        if (this.callbacks.isStopAlreadyRequested?.()) {
            return;
        }

        if (!this.awaitingConfirmation) {
            if (key.name?.toLowerCase() === "s") {
                this.awaitingConfirmation = true;
                process.stdout.write(
                    "\nGraceful stop requested. Confirm with 'y' (or cancel with 'n').\n",
                );
            }
            return;
        }

        if (key.name?.toLowerCase() === "y") {
            this.awaitingConfirmation = false;
            process.stdout.write(
                "Stopping crawl gracefully after current audits. Reports will still be generated...\n",
            );
            this.callbacks.onConfirmedStop();
            return;
        }

        if (key.name?.toLowerCase() === "n" || key.name === "escape") {
            this.awaitingConfirmation = false;
            process.stdout.write("Graceful stop cancelled.\n");
        }
    };
}
