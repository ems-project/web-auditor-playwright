import fsp from "node:fs/promises";

import { BasePlugin } from "../engine/BasePlugin.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { IPlugin, MetaItem, PluginPhase, ResourceContext } from "../engine/types.js";

type ImageMetadataPluginOptions = {
    maxFileSizeBytes?: number;
};

type ImageMetadata = {
    format: string;
    width?: number;
    height?: number;
    bitDepth?: number;
    colorType?: string;
    progressive?: boolean;
    animated?: boolean;
    exifOrientation?: number;
    copyright?: string;
};

export class ImageMetadataPlugin extends BasePlugin implements IPlugin {
    name = "image-metadata";
    phases: PluginPhase[] = ["download"];

    private readonly maxFileSizeBytes: number;

    constructor(options: ImageMetadataPluginOptions = {}) {
        super();
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 20 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        const mime = ctx.downloaded?.mime;
        return !!ctx.downloaded?.savedPath && !!mime && this.isSupportedMime(mime);
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        const mime = ctx.downloaded?.mime;
        const size = ctx.downloaded?.size;

        if (!savedPath || !mime || typeof size !== "number") {
            return;
        }

        if (size > this.maxFileSizeBytes) {
            this.registerWarning(
                ctx,
                "resources",
                "IMAGE_METADATA_SKIPPED_TOO_LARGE",
                `Image metadata extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            return;
        }

        try {
            const buffer = await fsp.readFile(savedPath);
            const metadata = this.extractMetadataFromBuffer(buffer, mime);

            ctx.report.metas = this.mergeMetas(ctx.report.metas ?? [], metadata, mime);
            ctx.report.message = `Image metadata extracted from ${mime}.`;
            ctx.report.title ??= ctx.downloaded?.suggestedFilename ?? null;

            if (!metadata.copyright?.trim()) {
                this.registerWarning(
                    ctx,
                    "compliance",
                    "IMAGE_METADATA_COPYRIGHT_MISSING",
                    "Image metadata does not contain copyright information.",
                    {
                        mime,
                        format: metadata.format,
                    },
                );
            }

            this.register(ctx);
        } catch (error) {
            this.registerWarning(
                ctx,
                "plugins",
                "IMAGE_METADATA_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("Failed to extract image metadata", error),
            );
        }
    }

    private isSupportedMime(mime: string): boolean {
        return [
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/svg+xml",
            "image/bmp",
        ].includes(mime);
    }

    private mergeMetas(existing: MetaItem[], metadata: ImageMetadata, mime: string): MetaItem[] {
        const incoming: MetaItem[] = [
            { key: "image_mime", value: mime },
            { key: "image_format", value: metadata.format },
        ];

        if (typeof metadata.width === "number") {
            incoming.push({ key: "image_width", value: `${metadata.width}` });
        }
        if (typeof metadata.height === "number") {
            incoming.push({ key: "image_height", value: `${metadata.height}` });
        }
        if (typeof metadata.bitDepth === "number") {
            incoming.push({ key: "image_bit_depth", value: `${metadata.bitDepth}` });
        }
        if (metadata.colorType) {
            incoming.push({ key: "image_color_type", value: metadata.colorType });
        }
        if (typeof metadata.progressive === "boolean") {
            incoming.push({ key: "image_progressive", value: `${metadata.progressive}` });
        }
        if (typeof metadata.animated === "boolean") {
            incoming.push({ key: "image_animated", value: `${metadata.animated}` });
        }
        if (typeof metadata.exifOrientation === "number") {
            incoming.push({
                key: "image_exif_orientation",
                value: `${metadata.exifOrientation}`,
            });
        }
        if (metadata.copyright?.trim()) {
            incoming.push({ key: "image_copyright", value: metadata.copyright.trim() });
        }

        const map = new Map(existing.map((item) => [item.key, item]));
        for (const item of incoming) {
            map.set(item.key, item);
        }
        return [...map.values()];
    }

    private extractMetadataFromBuffer(buffer: Buffer, mime: string): ImageMetadata {
        switch (mime) {
            case "image/png":
                return this.parsePng(buffer);
            case "image/jpeg":
                return this.parseJpeg(buffer);
            case "image/gif":
                return this.parseGif(buffer);
            case "image/webp":
                return this.parseWebp(buffer);
            case "image/svg+xml":
                return this.parseSvg(buffer.toString("utf8"));
            case "image/bmp":
                return this.parseBmp(buffer);
            default:
                throw new Error(`Unsupported image MIME type: ${mime}`);
        }
    }

    private parsePng(buffer: Buffer): ImageMetadata {
        const signature = "89504e470d0a1a0a";
        if (buffer.length < 26 || buffer.subarray(0, 8).toString("hex") !== signature) {
            throw new Error("Invalid PNG file signature");
        }

        let offset = 8;
        let width: number | undefined;
        let height: number | undefined;
        let bitDepth: number | undefined;
        let colorType: string | undefined;
        let copyright: string | undefined;

        while (offset + 8 <= buffer.length) {
            const chunkLength = buffer.readUInt32BE(offset);
            const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");
            const chunkDataStart = offset + 8;
            const chunkDataEnd = chunkDataStart + chunkLength;
            if (chunkDataEnd + 4 > buffer.length) {
                throw new Error("Invalid PNG chunk length");
            }

            const chunk = buffer.subarray(chunkDataStart, chunkDataEnd);
            if (chunkType === "IHDR") {
                width = chunk.readUInt32BE(0);
                height = chunk.readUInt32BE(4);
                bitDepth = chunk.readUInt8(8);
                colorType = this.describePngColorType(chunk.readUInt8(9));
            } else if (chunkType === "tEXt" || chunkType === "iTXt") {
                const parsed = this.parsePngTextChunk(chunkType, chunk);
                if (parsed && this.isCopyrightKeyword(parsed.keyword) && parsed.value.trim()) {
                    copyright = parsed.value.trim();
                }
            }

            offset = chunkDataEnd + 4;
            if (chunkType === "IEND") {
                break;
            }
        }

        return {
            format: "png",
            width,
            height,
            bitDepth,
            colorType,
            copyright,
        };
    }

    private parseGif(buffer: Buffer): ImageMetadata {
        if (buffer.length < 10) {
            throw new Error("GIF file is too short");
        }

        const header = buffer.subarray(0, 6).toString("ascii");
        if (header !== "GIF87a" && header !== "GIF89a") {
            throw new Error("Invalid GIF file signature");
        }

        return {
            format: "gif",
            width: buffer.readUInt16LE(6),
            height: buffer.readUInt16LE(8),
            animated: buffer.includes(Buffer.from("NETSCAPE2.0", "ascii")),
        };
    }

    private parseBmp(buffer: Buffer): ImageMetadata {
        if (buffer.length < 30 || buffer.subarray(0, 2).toString("ascii") !== "BM") {
            throw new Error("Invalid BMP file signature");
        }

        return {
            format: "bmp",
            width: Math.abs(buffer.readInt32LE(18)),
            height: Math.abs(buffer.readInt32LE(22)),
            bitDepth: buffer.readUInt16LE(28),
        };
    }

    private parseJpeg(buffer: Buffer): ImageMetadata {
        if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
            throw new Error("Invalid JPEG file signature");
        }

        let offset = 2;
        let orientation: number | undefined;
        let copyright: string | undefined;

        while (offset + 3 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }

            const marker = buffer[offset + 1];
            if (marker === 0xd9 || marker === 0xda) {
                break;
            }

            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 2;
                continue;
            }

            const segmentLength = buffer.readUInt16BE(offset + 2);
            if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
                throw new Error("Invalid JPEG segment length");
            }

            const segmentStart = offset + 4;
            const segmentEnd = offset + 2 + segmentLength;
            const segment = buffer.subarray(segmentStart, segmentEnd);

            if (marker === 0xe1) {
                const exif = this.parseExifMetadata(segment);
                orientation ??= exif.orientation;
                copyright ??= exif.copyright;
            }

            if (this.isJpegStartOfFrame(marker)) {
                return {
                    format: "jpeg",
                    width: buffer.readUInt16BE(segmentStart + 3),
                    height: buffer.readUInt16BE(segmentStart + 1),
                    bitDepth: buffer.readUInt8(segmentStart),
                    progressive: marker === 0xc2,
                    exifOrientation: orientation,
                    copyright,
                };
            }

            offset = segmentEnd;
        }

        throw new Error("JPEG dimensions not found");
    }

    private parseWebp(buffer: Buffer): ImageMetadata {
        if (
            buffer.length < 16 ||
            buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
            buffer.subarray(8, 12).toString("ascii") !== "WEBP"
        ) {
            throw new Error("Invalid WebP file signature");
        }

        let offset = 12;
        while (offset + 8 <= buffer.length) {
            const chunkType = buffer.subarray(offset, offset + 4).toString("ascii");
            const chunkSize = buffer.readUInt32LE(offset + 4);
            const chunkStart = offset + 8;
            const chunkEnd = chunkStart + chunkSize;
            if (chunkEnd > buffer.length) {
                throw new Error("Invalid WebP chunk length");
            }

            if (chunkType === "VP8X") {
                return {
                    format: "webp",
                    width: 1 + buffer.readUIntLE(chunkStart + 4, 3),
                    height: 1 + buffer.readUIntLE(chunkStart + 7, 3),
                };
            }

            if (chunkType === "VP8 ") {
                if (chunkSize < 10) {
                    throw new Error("VP8 chunk too short");
                }

                return {
                    format: "webp",
                    width: buffer.readUInt16LE(chunkStart + 6) & 0x3fff,
                    height: buffer.readUInt16LE(chunkStart + 8) & 0x3fff,
                };
            }

            if (chunkType === "VP8L") {
                if (chunkSize < 5) {
                    throw new Error("VP8L chunk too short");
                }

                const b1 = buffer[chunkStart + 1] ?? 0;
                const b2 = buffer[chunkStart + 2] ?? 0;
                const b3 = buffer[chunkStart + 3] ?? 0;
                const b4 = buffer[chunkStart + 4] ?? 0;

                return {
                    format: "webp",
                    width: 1 + (b1 | ((b2 & 0x3f) << 8)),
                    height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
                };
            }

            offset = chunkEnd + (chunkSize % 2);
        }

        throw new Error("WebP dimensions not found");
    }

    private parseSvg(text: string): ImageMetadata {
        const svgTag = text.match(/<svg\b[^>]*>/i)?.[0];
        if (!svgTag) {
            throw new Error("SVG root element not found");
        }

        const width = this.extractSvgDimension(svgTag, "width");
        const height = this.extractSvgDimension(svgTag, "height");
        const viewBoxMatch = svgTag.match(
            /viewBox\s*=\s*["'][^"']*?(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)["']/i,
        );
        const copyright = this.extractSvgCopyright(text);

        return {
            format: "svg",
            width: width ?? (viewBoxMatch ? Number(viewBoxMatch[3]) : undefined),
            height: height ?? (viewBoxMatch ? Number(viewBoxMatch[4]) : undefined),
            copyright,
        };
    }

    private parsePngTextChunk(
        chunkType: string,
        chunk: Buffer,
    ): { keyword: string; value: string } | null {
        if (chunkType === "tEXt") {
            const separator = chunk.indexOf(0);
            if (separator <= 0) {
                return null;
            }

            return {
                keyword: chunk.subarray(0, separator).toString("latin1"),
                value: chunk.subarray(separator + 1).toString("latin1"),
            };
        }

        const firstSeparator = chunk.indexOf(0);
        if (firstSeparator <= 0 || firstSeparator + 5 > chunk.length) {
            return null;
        }

        const keyword = chunk.subarray(0, firstSeparator).toString("utf8");
        const compressionFlag = chunk[firstSeparator + 1];
        const languageStart = firstSeparator + 3;
        const languageEnd = chunk.indexOf(0, languageStart);
        if (languageEnd === -1) {
            return null;
        }

        const translatedEnd = chunk.indexOf(0, languageEnd + 1);
        if (translatedEnd === -1) {
            return null;
        }

        if (compressionFlag !== 0) {
            return null;
        }

        return {
            keyword,
            value: chunk.subarray(translatedEnd + 1).toString("utf8"),
        };
    }

    private extractSvgDimension(svgTag: string, attribute: string): number | undefined {
        const match = svgTag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
        const rawValue = match?.[1]?.trim();
        if (!rawValue || rawValue.endsWith("%")) {
            return undefined;
        }

        const numeric = Number.parseFloat(rawValue);
        return Number.isFinite(numeric) ? numeric : undefined;
    }

    private extractSvgCopyright(text: string): string | undefined {
        const patterns = [
            /<dc:rights[^>]*>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>[\s\S]*?<\/dc:rights>/i,
            /<cc:license[^>]*>([\s\S]*?)<\/cc:license>/i,
            /<metadata[^>]*>[\s\S]*?copyright([\s\S]*?)<\/metadata>/i,
        ];

        for (const pattern of patterns) {
            const value = pattern
                .exec(text)?.[1]
                ?.replace(/<[^>]+>/g, " ")
                .trim();
            if (value) {
                return value;
            }
        }

        return undefined;
    }

    private parseExifMetadata(segment: Buffer): {
        orientation?: number;
        copyright?: string;
    } {
        if (segment.length < 14 || segment.subarray(0, 6).toString("ascii") !== "Exif\0\0") {
            return {};
        }

        const tiff = segment.subarray(6);
        if (tiff.length < 8) {
            return {};
        }

        const byteOrder = tiff.subarray(0, 2).toString("ascii");
        if (byteOrder !== "II" && byteOrder !== "MM") {
            return {};
        }

        const littleEndian = byteOrder === "II";
        const readUInt16 = (offset: number): number =>
            littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
        const readUInt32 = (offset: number): number =>
            littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);

        if (readUInt16(2) !== 0x2a) {
            return {};
        }

        const ifdOffset = readUInt32(4);
        if (ifdOffset + 2 > tiff.length) {
            return {};
        }

        const entryCount = readUInt16(ifdOffset);
        let orientation: number | undefined;
        let copyright: string | undefined;

        for (let index = 0; index < entryCount; index += 1) {
            const entryOffset = ifdOffset + 2 + index * 12;
            if (entryOffset + 12 > tiff.length) {
                break;
            }

            const tag = readUInt16(entryOffset);
            const type = readUInt16(entryOffset + 2);
            const count = readUInt32(entryOffset + 4);

            if (tag === 0x0112 && type === 3 && count >= 1) {
                orientation = littleEndian
                    ? tiff.readUInt16LE(entryOffset + 8)
                    : tiff.readUInt16BE(entryOffset + 8);
            }

            if (tag === 0x8298 && type === 2 && count > 0) {
                copyright = this.readExifAsciiValue(tiff, entryOffset + 8, count, littleEndian);
            }
        }

        return { orientation, copyright: copyright?.trim() || undefined };
    }

    private readExifAsciiValue(
        tiff: Buffer,
        valueOffset: number,
        count: number,
        littleEndian: boolean,
    ): string | undefined {
        const dataOffset =
            count <= 4
                ? valueOffset
                : littleEndian
                  ? tiff.readUInt32LE(valueOffset)
                  : tiff.readUInt32BE(valueOffset);

        const endOffset = dataOffset + count;
        if (dataOffset < 0 || endOffset > tiff.length) {
            return undefined;
        }

        return tiff.subarray(dataOffset, endOffset).toString("latin1").replace(/\0+$/, "");
    }

    private isJpegStartOfFrame(marker: number): boolean {
        return [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
        ].includes(marker);
    }

    private isCopyrightKeyword(keyword: string): boolean {
        const normalized = keyword.trim().toLowerCase();
        return normalized === "copyright" || normalized === "rights";
    }

    private describePngColorType(value: number): string {
        switch (value) {
            case 0:
                return "grayscale";
            case 2:
                return "rgb";
            case 3:
                return "indexed";
            case 4:
                return "grayscale-alpha";
            case 6:
                return "rgba";
            default:
                return `unknown-${value}`;
        }
    }

    isAuditPlugin(): boolean {
        return true;
    }
}
