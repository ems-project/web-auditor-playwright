import assert from "node:assert/strict";
import test from "node:test";

import { ImageMetadataPlugin } from "../src/plugins/ImageMetadataPlugin.js";

function createPlugin(overrides: { maxFileSizeBytes?: number } = {}) {
    return new ImageMetadataPlugin(overrides);
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: ImageMetadataPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("extractMetadataFromBuffer parses PNG dimensions and color metadata", () => {
    const plugin = createPlugin();
    const buffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x01, 0x90, 0x00, 0x00, 0x00, 0xc8, 0x08, 0x06,
    ]);

    const metadata = callPrivateMethod<[Buffer, string], Record<string, unknown>>(
        plugin,
        "extractMetadataFromBuffer",
        buffer,
        "image/png",
    );

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 400);
    assert.equal(metadata.height, 200);
    assert.equal(metadata.bitDepth, 8);
    assert.equal(metadata.colorType, "rgba");
});

test("extractMetadataFromBuffer parses SVG dimensions from viewBox", () => {
    const plugin = createPlugin();
    const svg = Buffer.from('<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg"></svg>');

    const metadata = callPrivateMethod<[Buffer, string], Record<string, unknown>>(
        plugin,
        "extractMetadataFromBuffer",
        svg,
        "image/svg+xml",
    );

    assert.equal(metadata.format, "svg");
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 180);
});

test("mergeMetas injects normalized metadata keys into the report", () => {
    const plugin = createPlugin();

    const metas = callPrivateMethod<
        [Array<{ key: string; value: string }>, Record<string, unknown>, string],
        Array<{ key: string; value: string }>
    >(
        plugin,
        "mergeMetas",
        [{ key: "existing", value: "true" }],
        {
            format: "jpeg",
            width: 1600,
            height: 900,
            progressive: true,
            exifOrientation: 6,
        },
        "image/jpeg",
    );

    assert.deepEqual(metas, [
        { key: "existing", value: "true" },
        { key: "image_mime", value: "image/jpeg" },
        { key: "image_format", value: "jpeg" },
        { key: "image_width", value: "1600" },
        { key: "image_height", value: "900" },
        { key: "image_progressive", value: "true" },
        { key: "image_exif_orientation", value: "6" },
    ]);
});
