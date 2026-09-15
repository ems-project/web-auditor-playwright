import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { FrameTracker } from "../src/engine/FrameTracker.js";

/**
 * Tests for the FrameTracker class with event-based frame detection.
 */

describe("FrameTracker", () => {
    // Mock page object for testing
    const createMockPage = (
        options: {
            iframeCount?: number;
            frameUrls?: string[];
            frames?: string[];
            shouldFailFrameLoad?: boolean;
            shouldTimeoutFrameLoad?: boolean;
        } = {},
    ) => {
        const {
            iframeCount = 0,
            frames = [],
            shouldFailFrameLoad = false,
            shouldTimeoutFrameLoad = false,
        } = options;

        const eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

        const mockPage = {
            locator: mock.fn(() => ({
                count: mock.fn(async () => iframeCount),
            })),
            frames: mock.fn(() => {
                const mainFrame = { url: () => "https://example.com" };
                return [
                    mainFrame,
                    ...frames.map((frameUrl) => ({
                        url: () => frameUrl,
                        waitForLoadState: mock.fn(
                            async (state: string, options?: { timeout?: number }) => {
                                if (shouldFailFrameLoad) {
                                    throw new Error("Frame load failed");
                                }
                                if (shouldTimeoutFrameLoad && (options?.timeout || 0) < 10000) {
                                    throw new Error("Frame load timeout");
                                }
                                return Promise.resolve();
                            },
                        ),
                    })),
                ];
            }),
            mainFrame: mock.fn(() => ({ url: () => "https://example.com" })),
            on: mock.fn((event: string, listener: (...args: unknown[]) => void) => {
                if (!eventListeners[event]) {
                    eventListeners[event] = [];
                }
                eventListeners[event].push(listener);
            }),
            off: mock.fn((event: string, listener: (...args: unknown[]) => void) => {
                if (eventListeners[event]) {
                    const index = eventListeners[event].indexOf(listener);
                    if (index > -1) {
                        eventListeners[event].splice(index, 1);
                    }
                }
            }),
            emit: (event: string, ...args: unknown[]) => {
                if (eventListeners[event]) {
                    eventListeners[event].forEach((listener) => listener(...args));
                }
            },
        };

        return mockPage as unknown as Page;
    };

    const createMockFrame = (url: string) => ({
        url: () => url,
        waitForLoadState: mock.fn(async () => Promise.resolve()),
    });

    before(() => {
        // Set test environment variables
        process.env.FRAME_WAIT_TIMEOUT_MS = "1000";
        process.env.FRAME_LOAD_TIMEOUT_MS = "2000";
    });

    after(() => {
        // Clean up environment variables
        delete process.env.FRAME_WAIT_TIMEOUT_MS;
        delete process.env.FRAME_LOAD_TIMEOUT_MS;
    });

    describe("analyzeAndWaitForFrames", () => {
        it("should handle pages with no iframes", async () => {
            const mockPage = createMockPage({ iframeCount: 0 });

            const result = await FrameTracker.analyzeAndWaitForFrames(mockPage);

            assert.equal(result.iframeCount, 0);
            assert.equal(result.framesReady, true);
            assert.deepEqual(result.frameUrls, []);
            assert.ok(result.frameDetectionInfo);
            assert.equal(result.frameDetectionInfo.attachedFrames, 0);
            assert.equal(result.frameDetectionInfo.failedFrames, 0);
            assert.equal(result.frameDetectionInfo.blockedFrames, 0);
            assert.equal(result.frameDetectionInfo.timeoutFrames, 0);
        });

        it("should handle pages with iframes that load successfully", async () => {
            const frameUrls = ["https://example.com/frame1", "https://example.com/frame2"];
            const frames = frameUrls.map(createMockFrame);
            const mockPage = createMockPage({
                iframeCount: 2,
                frameUrls,
                frames,
            });

            const result = await FrameTracker.analyzeAndWaitForFrames(mockPage);

            assert.equal(result.iframeCount, 2);
            assert.equal(result.framesReady, true);
            assert.deepEqual(result.frameUrls, frameUrls);
            assert.ok(result.frameDetectionInfo);
            assert.equal(result.frameDetectionInfo.attachedFrames, 2);
            assert.equal(result.frameDetectionInfo.failedFrames, 0);
        });

        it("should handle pages with blocked or failed iframes", async () => {
            const mockPage = createMockPage({
                iframeCount: 2,
                frameUrls: [],
                frames: [], // No frames attached despite 2 iframes in DOM
            });

            const result = await FrameTracker.analyzeAndWaitForFrames(mockPage);

            assert.equal(result.iframeCount, 2);
            assert.equal(result.framesReady, false);
            assert.deepEqual(result.frameUrls, []);
            assert.ok(result.frameDetectionInfo);
            assert.equal(result.frameDetectionInfo.attachedFrames, 0);
            assert.equal(result.frameDetectionInfo.failedFrames, 2);
        });

        it("should use custom timeout parameters", async () => {
            const mockPage = createMockPage({ iframeCount: 0 });

            const customFrameWaitTimeoutMs = 500;
            const customFrameLoadTimeoutMs = 1000;

            const result = await FrameTracker.analyzeAndWaitForFrames(
                mockPage,
                customFrameWaitTimeoutMs,
                customFrameLoadTimeoutMs,
            );

            assert.equal(result.iframeCount, 0);
            assert.equal(result.framesReady, true);
        });

        it("should handle frame load failures gracefully", async () => {
            const frameUrls = ["https://example.com/frame1"];
            const frames = frameUrls.map(createMockFrame);
            const mockPage = createMockPage({
                iframeCount: 1,
                frameUrls,
                frames,
                shouldFailFrameLoad: true,
            });

            const result = await FrameTracker.analyzeAndWaitForFrames(mockPage);

            assert.equal(result.iframeCount, 1);
            assert.equal(result.framesReady, false); // Should be false due to load failure
            assert.deepEqual(result.frameUrls, frameUrls);
        });

        it("should handle errors during frame detection", async () => {
            const mockPage = {
                locator: () => {
                    throw new Error("Locator failed");
                },
            } as unknown as Page;

            const result = await FrameTracker.analyzeAndWaitForFrames(mockPage);

            assert.equal(result.iframeCount, 0);
            assert.equal(result.framesReady, false);
            assert.deepEqual(result.frameUrls, []);
            assert.ok(result.frameDetectionInfo);
            assert.ok(
                result.frameDetectionInfo.frameEvents.some((event) =>
                    event.includes("Error during frame detection"),
                ),
            );
        });
    });
    describe("hasIframes", () => {
        it("should return iframe count", async () => {
            const mockPage = createMockPage({ iframeCount: 3 });

            const count = await FrameTracker.hasIframes(mockPage);

            assert.equal(count, 3);
        });

        it("should return 0 on error", async () => {
            const mockPage = {
                locator: () => {
                    throw new Error("Locator failed");
                },
            } as unknown as Page;

            const count = await FrameTracker.hasIframes(mockPage);

            assert.equal(count, 0);
        });
    });

    describe("getCurrentFrameInfo", () => {
        it("should return current frame information", async () => {
            const frameUrls = ["https://example.com/frame1"];
            const frames = frameUrls.map(createMockFrame);
            const mockPage = createMockPage({
                iframeCount: 1,
                frameUrls,
                frames,
            });

            const result = await FrameTracker.getCurrentFrameInfo(mockPage);

            assert.equal(result.iframeCount, 1);
            assert.equal(result.framesReady, true);
            assert.deepEqual(result.frameUrls, frameUrls);
            assert.ok(result.frameDetectionInfo);
            assert.equal(result.frameDetectionInfo.attachedFrames, 1);
            assert.equal(result.frameDetectionInfo.failedFrames, 0);
        });

        it("should handle errors gracefully", async () => {
            const mockPage = {
                locator: () => {
                    throw new Error("Locator failed");
                },
            } as unknown as Page;

            const result = await FrameTracker.getCurrentFrameInfo(mockPage);

            assert.equal(result.iframeCount, 0);
            assert.equal(result.framesReady, true);
            assert.deepEqual(result.frameUrls, []);
        });
    });
});
