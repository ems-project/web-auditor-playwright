import fsp from "node:fs/promises";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";

export class CleanDownloadedPlugin extends BasePlugin implements IPlugin {
    name = "clean-downloaded";
    phases: PluginPhase[] = ["finally"];

    applies(ctx: ResourceContext): boolean {
        return !!ctx.downloaded?.savedPath && ctx.downloaded.cleanup !== false;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        if (!savedPath) {
            return;
        }

        try {
            await fsp.unlink(savedPath);
        } catch (error) {
            this.registerWarning(
                ctx,
                "DOWNLOADED_FILE_CLEANUP_FAILED",
                ErrorUtils.errorMessage("Failed to remove temporary downloaded file", error),
            );
        }

        this.register(ctx);
    }
}
