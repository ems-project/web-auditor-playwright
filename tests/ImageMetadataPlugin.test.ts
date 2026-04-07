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
        0x52, 0x00, 0x00, 0x01, 0x90, 0x00, 0x00, 0x00, 0xc8, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
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

test("parseExifMetadata extracts orientation and copyright", () => {
    const plugin = createPlugin();
    const segment = Buffer.from([
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x02,
        0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x98, 0x82,
        0x02, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x43,
        0x6f, 0x70, 0x79, 0x72, 0x69, 0x67, 0x68, 0x74, 0x00, 0x00,
    ]);

    const metadata = callPrivateMethod<[Buffer], { orientation?: number; copyright?: string }>(
        plugin,
        "parseExifMetadata",
        segment,
    );

    assert.equal(metadata.orientation, 6);
    assert.equal(metadata.copyright, "Copyright");
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
            copyright: "Copyright Example",
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
        { key: "image_copyright", value: "Copyright Example" },
    ]);
});

test("extractSvgCopyright reads dc:rights metadata", () => {
    const plugin = createPlugin();
    const svg =
        '<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><metadata><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright ACME</rdf:li></rdf:Alt></dc:rights></metadata></svg>';

    const value = callPrivateMethod<[string], string | undefined>(
        plugin,
        "extractSvgCopyright",
        svg,
    );

    assert.equal(value, "Copyright ACME");
});
