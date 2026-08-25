import type { Page } from "playwright";
import type { FrameLoadingInfo } from "./types.js";

/**
 * Engine-level iframe tracking utility that provides intelligent waiting
 * for iframe resources to load, addressing performance concerns from plugins.
 */
export class FrameTracker {
    /**
     * Analyzes page iframe structure and waits intelligently for frame loading completion.
     * This method replaces plugin-level arbitrary timeouts with engine-level intelligence.
     *
     * @param page - Playwright page instance
     * @returns Promise with frame loading information
     */
    static async analyzeAndWaitForFrames(page: Page): Promise<FrameLoadingInfo> {
        const startTime = Date.now();

        try {
            // Check if the page contains any iframe elements
            const iframeCount = await page.locator("iframe").count();

            if (iframeCount === 0) {
                return {
                    iframeCount: 0,
                    framesReady: true,
                    frameUrls: [],
                    frameLoadDuration: Date.now() - startTime,
                    frameLoadStartTime: startTime,
                };
            }

            // Get all frames (excluding main frame)
            let frames = page.frames().filter((frame) => frame !== page.mainFrame());

            if (frames.length === 0) {
                // No child frames loaded yet, wait a short time for them to appear
                await new Promise((resolve) => setTimeout(resolve, 500));
                frames = page.frames().filter((frame) => frame !== page.mainFrame());

                if (frames.length === 0) {
                    // Still no frames, they might be blocked, cross-origin, or slow to load
                    return {
                        iframeCount,
                        framesReady: false,
                        frameUrls: [],
                        frameLoadDuration: Date.now() - startTime,
                        frameLoadStartTime: startTime,
                    };
                }
            }

            // Collect frame URLs for debugging/reporting
            const frameUrls = frames.map((frame) => {
                try {
                    return frame.url();
                } catch {
                    return "about:blank"; // Cross-origin frames or other access issues
                }
            });

            // Wait for each iframe to reach a stable state
            const framePromises = frames.map(async (frame) => {
                try {
                    // Progressive timeout strategy: try quick states first, fall back to longer waits
                    await Promise.race([
                        // Quick completion for simple frames
                        frame.waitForLoadState("domcontentloaded", { timeout: 3000 }),
                        // Network-heavy frames get more time
                        frame.waitForLoadState("networkidle", { timeout: 5000 }),
                        // Absolute fallback to prevent hanging
                        new Promise((resolve) => setTimeout(resolve, 2000)),
                    ]);
                    return true;
                } catch {
                    // Frame might be cross-origin, have loading issues, or be blocked by CSP
                    // This is expected behavior for many real-world scenarios
                    return false;
                }
            });

            // Wait for all frames to complete or timeout
            const frameResults = await Promise.allSettled(framePromises);
            const successfulFrames = frameResults.filter(
                (result) => result.status === "fulfilled" && result.value === true,
            ).length;

            return {
                iframeCount,
                framesReady: successfulFrames === frames.length,
                frameUrls,
                frameLoadDuration: Date.now() - startTime,
                frameLoadStartTime: startTime,
            };
        } catch {
            // If iframe detection completely fails, provide fallback information
            return {
                iframeCount: 0,
                framesReady: false,
                frameUrls: [],
                frameLoadDuration: Date.now() - startTime,
                frameLoadStartTime: startTime,
            };
        }
    }

    /**
     * Quick check to determine if the page has any iframes.
     * Useful for plugins to decide whether to access frame information.
     *
     * @param page - Playwright page instance
     * @returns Promise resolving to iframe count
     */
    static async hasIframes(page: Page): Promise<number> {
        try {
            return await page.locator("iframe").count();
        } catch {
            return 0;
        }
    }

    /**
     * Gets current frame information without waiting.
     * Provides immediate access to frame state for analysis.
     *
     * @param page - Playwright page instance
     * @returns Current frame loading information
     */
    static async getCurrentFrameInfo(page: Page): Promise<FrameLoadingInfo> {
        try {
            const iframeCount = await page.locator("iframe").count();
            const frames = page.frames().filter((frame) => frame !== page.mainFrame());
            const frameUrls = frames.map((frame) => {
                try {
                    return frame.url();
                } catch {
                    return "about:blank";
                }
            });

            return {
                iframeCount,
                framesReady: frames.length === iframeCount, // Simple heuristic
                frameUrls,
            };
        } catch {
            return {
                iframeCount: 0,
                framesReady: true,
                frameUrls: [],
            };
        }
    }
}
