import assert from "node:assert/strict";
import test from "node:test";

import { ImagePlugin } from "../src/plugins/ImagePlugin.js";

type ImageIssue = {
    severity: string;
    category: string;
    code: string;
    message: string;
    data?: Record<string, unknown>;
};

type ImageMetrics = {
    viewportHeight: number;
    images: Array<{
        src: string | null;
        loading: string | null;
        width: number | null;
        height: number | null;
        renderedWidth: number;
        renderedHeight: number;
        top: number;
        pictureSourceFormats: string[];
    }>;
};

function createPlugin(
    overrides: {
        lazyLoadingAboveFoldBufferPx?: number;
        minLazyLoadingWidthPx?: number;
        minLazyLoadingHeightPx?: number;
    } = {},
) {
    return new ImagePlugin(overrides);
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: ImagePlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("buildImageIssues reports lazy loading, dimensions and non optimized formats", () => {
    const plugin = createPlugin({
        lazyLoadingAboveFoldBufferPx: 100,
        minLazyLoadingWidthPx: 80,
        minLazyLoadingHeightPx: 80,
    });

    const issues = callPrivateMethod<[ImageMetrics], ImageIssue[]>(plugin, "buildImageIssues", {
        viewportHeight: 800,
        images: [
            {
                src: "https://example.com/hero.jpg",
                loading: null,
                width: null,
                height: 400,
                renderedWidth: 1200,
                renderedHeight: 400,
                top: 1200,
                pictureSourceFormats: [],
            },
        ],
    });

    assert.deepEqual(
        issues.map((issue) => issue.code),
        ["IMAGE_MISSING_DIMENSIONS", "IMAGE_MISSING_LAZY_LOADING", "IMAGE_NON_OPTIMIZED_FORMAT"],
    );
});

test("buildImageIssues ignores above-the-fold and optimized images", () => {
    const plugin = createPlugin();

    const issues = callPrivateMethod<[ImageMetrics], ImageIssue[]>(plugin, "buildImageIssues", {
        viewportHeight: 900,
        images: [
            {
                src: "https://example.com/hero.avif",
                loading: "eager",
                width: 1200,
                height: 500,
                renderedWidth: 1200,
                renderedHeight: 500,
                top: 0,
                pictureSourceFormats: [],
            },
            {
                src: "https://example.com/gallery.jpg",
                loading: "lazy",
                width: 640,
                height: 480,
                renderedWidth: 640,
                renderedHeight: 480,
                top: 1500,
                pictureSourceFormats: ["image/avif"],
            },
        ],
    });

    assert.deepEqual(issues, []);
});

test("buildImageIssues reports missing image source URLs", () => {
    const plugin = createPlugin();

    const issues = callPrivateMethod<[ImageMetrics], ImageIssue[]>(plugin, "buildImageIssues", {
        viewportHeight: 800,
        images: [
            {
                src: null,
                loading: null,
                width: null,
                height: null,
                renderedWidth: 300,
                renderedHeight: 200,
                top: 400,
                pictureSourceFormats: [],
            },
        ],
    });

    assert.deepEqual(
        issues.map((issue) => issue.code),
        ["MISSING_URL"],
    );
    assert.equal(issues[0].message, "Image is missing a source URL.");
});
