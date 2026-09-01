import type { Page, Frame, Request } from "playwright";
import type { FrameLoadingInfo, FrameDetectionInfo } from "./types.js";

/**
 * Engine-level iframe tracking utility that provides intelligent waiting
 * for iframe resources to load
 */
export class FrameTracker {
    /**
     * Analyzes page iframe structure and waits intelligently for frame loading completion.
     * Uses event-based frame detection with configurable timeouts.
     *
     * @param page - Playwright page instance
     * @param frameWaitTimeoutMs - Maximum time to wait for frames to attach (default from env FRAME_WAIT_TIMEOUT_MS or 3000)
     * @param frameLoadTimeoutMs - Maximum time to wait for frame loading (default from env FRAME_LOAD_TIMEOUT_MS or 5000)
     * @returns Promise with frame loading information
     */
    static async analyzeAndWaitForFrames(
        page: Page,
        frameWaitTimeoutMs?: number,
        frameLoadTimeoutMs?: number,
    ): Promise<FrameLoadingInfo> {
        const startTime = Date.now();
        const waitTimeout =
            frameWaitTimeoutMs ?? parseInt(process.env.FRAME_WAIT_TIMEOUT_MS || "3000", 10);
        const loadTimeout =
            frameLoadTimeoutMs ?? parseInt(process.env.FRAME_LOAD_TIMEOUT_MS || "5000", 10);

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
                    frameDetectionInfo: {
                        attachedFrames: 0,
                        failedFrames: 0,
                        blockedFrames: 0,
                        timeoutFrames: 0,
                        frameEvents: [],
                    },
                };
            }

            // Wait for frames to attach and load using event-based detection
            const frameDetectionResult = await this.waitForFrameAttachment(
                page,
                iframeCount,
                waitTimeout,
            );
            const frames = page.frames().filter((frame) => frame !== page.mainFrame());

            // If we still don't have the expected number of frames, some might be blocked or failed
            const frameDetectionInfo: FrameDetectionInfo = {
                attachedFrames: frames.length,
                failedFrames: Math.max(0, iframeCount - frames.length),
                blockedFrames: frameDetectionResult.blockedFrames,
                timeoutFrames: frameDetectionResult.timeoutFrames,
                frameEvents: frameDetectionResult.events,
            };

            if (frames.length === 0) {
                return {
                    iframeCount,
                    framesReady: false,
                    frameUrls: [],
                    frameLoadDuration: Date.now() - startTime,
                    frameLoadStartTime: startTime,
                    frameDetectionInfo,
                };
            }

            // Collect frame URLs for debugging/reporting
            const frameUrls = frames.map((frame) => {
                try {
                    return frame.url();
                } catch {
                    return "about:blank"; // Cross-origin frames or other access issues
                }
            });

            // Wait for each frame to reach a stable state using configurable timeout
            const frameLoadResults = await this.waitForFrameLoading(frames, loadTimeout);

            return {
                iframeCount,
                framesReady: frameLoadResults.successfulFrames === frames.length,
                frameUrls,
                frameLoadDuration: Date.now() - startTime,
                frameLoadStartTime: startTime,
                frameDetectionInfo: {
                    ...frameDetectionInfo,
                    timeoutFrames:
                        frameDetectionInfo.timeoutFrames + frameLoadResults.timeoutFrames,
                },
            };
        } catch (error) {
            // If iframe detection completely fails, provide fallback information
            return {
                iframeCount: 0,
                framesReady: false,
                frameUrls: [],
                frameLoadDuration: Date.now() - startTime,
                frameLoadStartTime: startTime,
                frameDetectionInfo: {
                    attachedFrames: 0,
                    failedFrames: 0,
                    blockedFrames: 0,
                    timeoutFrames: 0,
                    frameEvents: [`Error during frame detection: ${error}`],
                },
            };
        }
    }

    /**
     * Event-based frame attachment detection with timeout.
     * Listens to frameattached, framenavigated, framedetached, and requestfailed events.
     *
     * @param page - Playwright page instance
     * @param expectedFrameCount - Number of iframes expected from DOM
     * @param timeoutMs - Maximum time to wait for frames to attach
     * @returns Promise with frame detection results
     */
    private static async waitForFrameAttachment(
        page: Page,
        expectedFrameCount: number,
        timeoutMs: number,
    ): Promise<{
        attachedFrames: Frame[];
        blockedFrames: number;
        timeoutFrames: number;
        events: string[];
    }> {
        return new Promise((resolve) => {
            const events: string[] = [];
            const attachedFrames: Frame[] = [];
            let blockedFrames = 0;
            let requestFailures = 0;

            const cleanup = () => {
                page.off("frameattached", onFrameAttached);
                page.off("framenavigated", onFrameNavigated);
                page.off("framedetached", onFrameDetached);
                page.off("requestfailed", onRequestFailed);
            };

            const onFrameAttached = (frame: Frame) => {
                if (frame !== page.mainFrame()) {
                    attachedFrames.push(frame);
                    events.push(`Frame attached: ${frame.url() || "about:blank"}`);

                    // Check if we've reached the expected count
                    if (attachedFrames.length >= expectedFrameCount) {
                        cleanup();
                        resolve({
                            attachedFrames,
                            blockedFrames,
                            timeoutFrames: 0,
                            events,
                        });
                    }
                }
            };

            const onFrameNavigated = (frame: Frame) => {
                if (frame !== page.mainFrame()) {
                    events.push(`Frame navigated: ${frame.url() || "about:blank"}`);
                }
            };

            const onFrameDetached = (frame: Frame) => {
                if (frame !== page.mainFrame()) {
                    events.push(`Frame detached: ${frame.url() || "about:blank"}`);
                    // Remove from attached frames if it was there
                    const index = attachedFrames.indexOf(frame);
                    if (index > -1) {
                        attachedFrames.splice(index, 1);
                    }
                }
            };

            const onRequestFailed = (request: Request) => {
                // Check if this is a frame request that failed
                if (request.frame() && request.frame() !== page.mainFrame()) {
                    requestFailures++;
                    events.push(
                        `Frame request failed: ${request.url()} - ${request.failure()?.errorText}`,
                    );
                }
            };

            // Register event listeners
            page.on("frameattached", onFrameAttached);
            page.on("framenavigated", onFrameNavigated);
            page.on("framedetached", onFrameDetached);
            page.on("requestfailed", onRequestFailed);

            // Set timeout
            setTimeout(() => {
                cleanup();
                blockedFrames = Math.max(
                    0,
                    expectedFrameCount - attachedFrames.length - requestFailures,
                );
                resolve({
                    attachedFrames,
                    blockedFrames,
                    timeoutFrames: Math.max(0, expectedFrameCount - attachedFrames.length),
                    events,
                });
            }, timeoutMs);

            // Check if frames are already attached
            const currentFrames = page.frames().filter((frame) => frame !== page.mainFrame());
            if (currentFrames.length > 0) {
                currentFrames.forEach((frame) => {
                    if (!attachedFrames.includes(frame)) {
                        attachedFrames.push(frame);
                        events.push(`Frame already attached: ${frame.url() || "about:blank"}`);
                    }
                });

                if (attachedFrames.length >= expectedFrameCount) {
                    cleanup();
                    resolve({
                        attachedFrames,
                        blockedFrames,
                        timeoutFrames: 0,
                        events,
                    });
                }
            }
        });
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
     * Waits for frames to complete loading with progressive timeout strategy.
     *
     * @param frames - Array of frames to wait for
     * @param timeoutMs - Maximum time to wait for frame loading
     * @returns Promise with loading results
     */
    private static async waitForFrameLoading(
        frames: Frame[],
        timeoutMs: number,
    ): Promise<{ successfulFrames: number; timeoutFrames: number }> {
        const framePromises = frames.map(async (frame) => {
            try {
                // Progressive timeout strategy: try quick states first, fall back to longer waits
                await Promise.race([
                    // Quick completion for simple frames
                    frame.waitForLoadState("domcontentloaded", {
                        timeout: Math.min(timeoutMs * 0.6, 3000),
                    }),
                    // Network-heavy frames get more time
                    frame.waitForLoadState("networkidle", { timeout: timeoutMs }),
                    // Absolute fallback to prevent hanging
                    new Promise((resolve) => setTimeout(resolve, timeoutMs * 0.8)),
                ]);
                return { success: true, timeout: false };
            } catch {
                // Frame might be cross-origin, have loading issues, or be blocked by CSP
                // This is expected behavior for many real-world scenarios
                return { success: false, timeout: true };
            }
        });

        const frameResults = await Promise.allSettled(framePromises);
        const successfulFrames = frameResults.filter(
            (result) => result.status === "fulfilled" && result.value.success === true,
        ).length;
        const timeoutFrames = frameResults.filter(
            (result) => result.status === "fulfilled" && result.value.timeout === true,
        ).length;

        return { successfulFrames, timeoutFrames };
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
                frameDetectionInfo: {
                    attachedFrames: frames.length,
                    failedFrames: Math.max(0, iframeCount - frames.length),
                    blockedFrames: 0, // Cannot determine without event tracking
                    timeoutFrames: 0, // Cannot determine without event tracking
                    frameEvents: ["Current frame info - no event tracking"],
                },
            };
        } catch {
            return {
                iframeCount: 0,
                framesReady: true,
                frameUrls: [],
                frameDetectionInfo: {
                    attachedFrames: 0,
                    failedFrames: 0,
                    blockedFrames: 0,
                    timeoutFrames: 0,
                    frameEvents: ["Error getting current frame info"],
                },
            };
        }
    }
}
