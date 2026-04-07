import { BasePlugin } from "../engine/BasePlugin.js";
import type {
    FindingCategory,
    FindingCode,
    FindingData,
    FindingSeverity,
    IPlugin,
    PluginPhase,
    ResourceContext,
} from "../engine/types.js";

type ImagePluginOptions = {
    lazyLoadingAboveFoldBufferPx?: number;
    minLazyLoadingWidthPx?: number;
    minLazyLoadingHeightPx?: number;
};

type ImageRef = {
    src: string | null;
    loading: string | null;
    width: number | null;
    height: number | null;
    renderedWidth: number;
    renderedHeight: number;
    top: number;
    pictureSourceFormats: string[];
};

type ImageDomMetrics = {
    viewportHeight: number;
    images: ImageRef[];
};

type ImageIssue = {
    severity: FindingSeverity;
    category: FindingCategory;
    code: FindingCode;
    message: string;
    data?: FindingData;
};

export class ImagePlugin extends BasePlugin implements IPlugin {
    name = "image-audit";
    phases: PluginPhase[] = ["process"];

    private readonly lazyLoadingAboveFoldBufferPx: number;
    private readonly minLazyLoadingWidthPx: number;
    private readonly minLazyLoadingHeightPx: number;

    constructor(options: ImagePluginOptions = {}) {
        super();
        this.lazyLoadingAboveFoldBufferPx = options.lazyLoadingAboveFoldBufferPx ?? 200;
        this.minLazyLoadingWidthPx = options.minLazyLoadingWidthPx ?? 80;
        this.minLazyLoadingHeightPx = options.minLazyLoadingHeightPx ?? 80;
    }

    applies(): boolean {
        return true;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (!ctx.mime?.includes("text/html")) {
            return;
        }

        const metrics = await this.collectDomMetrics(ctx);
        const issues = this.buildImageIssues(metrics);

        for (const issue of issues) {
            this.registerFinding(
                issue.severity,
                issue.category,
                ctx,
                issue.code,
                issue.message,
                issue.data,
            );
        }

        this.register(ctx);
    }

    private async collectDomMetrics(ctx: ResourceContext): Promise<ImageDomMetrics> {
        return ctx.page.evaluate(() => {
            const parseDimension = (value: string | null): number | null => {
                if (!value) {
                    return null;
                }

                const numeric = Number(value);
                return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
            };

            const images = Array.from(document.querySelectorAll<HTMLImageElement>("img")).map(
                (image) => {
                    const rect = image.getBoundingClientRect();
                    const picture = image.closest("picture");
                    const pictureSourceFormats = picture
                        ? Array.from(picture.querySelectorAll<HTMLSourceElement>("source"))
                              .map((source) => source.getAttribute("type")?.trim().toLowerCase())
                              .filter((value): value is string => Boolean(value))
                        : [];

                    return {
                        src: image.currentSrc || image.getAttribute("src"),
                        loading: image.getAttribute("loading")?.trim().toLowerCase() ?? null,
                        width: parseDimension(image.getAttribute("width")),
                        height: parseDimension(image.getAttribute("height")),
                        renderedWidth: rect.width,
                        renderedHeight: rect.height,
                        top: rect.top,
                        pictureSourceFormats,
                    };
                },
            );

            return {
                viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
                images,
            };
        });
    }

    private buildImageIssues(metrics: ImageDomMetrics): ImageIssue[] {
        const issues: ImageIssue[] = [];

        for (const image of metrics.images) {
            if (!image.src) {
                issues.push({
                    severity: "warning",
                    category: "html",
                    code: "MISSING_URL",
                    message: "Image is missing a source URL.",
                });
                continue;
            }

            if (this.shouldWarnAboutMissingDimensions(image)) {
                issues.push({
                    severity: "warning",
                    category: "performance",
                    code: "IMAGE_MISSING_DIMENSIONS",
                    message: `Image is missing width or height attributes: ${image.src}`,
                    data: {
                        src: image.src,
                        width: image.width,
                        height: image.height,
                    },
                });
            }

            if (this.shouldWarnAboutMissingLazyLoading(image, metrics.viewportHeight)) {
                issues.push({
                    severity: "warning",
                    category: "performance",
                    code: "IMAGE_MISSING_LAZY_LOADING",
                    message: `Below-the-fold image should use loading="lazy": ${image.src}`,
                    data: {
                        src: image.src,
                        loading: image.loading,
                        top: image.top,
                    },
                });
            }

            if (this.shouldReportNonOptimizedFormat(image)) {
                issues.push({
                    severity: "info",
                    category: "performance",
                    code: "IMAGE_NON_OPTIMIZED_FORMAT",
                    message: `Image could use a more optimized format or responsive source: ${image.src}`,
                    data: {
                        src: image.src,
                        pictureSourceFormats: image.pictureSourceFormats,
                    },
                });
            }
        }

        return issues;
    }

    private shouldWarnAboutMissingDimensions(image: ImageRef): boolean {
        if (image.renderedWidth <= 1 || image.renderedHeight <= 1) {
            return false;
        }

        return image.width === null || image.height === null;
    }

    private shouldWarnAboutMissingLazyLoading(image: ImageRef, viewportHeight: number): boolean {
        if (image.renderedWidth < this.minLazyLoadingWidthPx) {
            return false;
        }

        if (image.renderedHeight < this.minLazyLoadingHeightPx) {
            return false;
        }

        if (image.top <= viewportHeight + this.lazyLoadingAboveFoldBufferPx) {
            return false;
        }

        return image.loading !== "lazy";
    }

    private shouldReportNonOptimizedFormat(image: ImageRef): boolean {
        const normalizedUrl = image.src?.toLowerCase() ?? "";

        if (
            normalizedUrl.startsWith("data:") ||
            normalizedUrl.startsWith("blob:") ||
            normalizedUrl.endsWith(".svg") ||
            normalizedUrl.endsWith(".webp") ||
            normalizedUrl.endsWith(".avif")
        ) {
            return false;
        }

        if (
            image.pictureSourceFormats.includes("image/avif") ||
            image.pictureSourceFormats.includes("image/webp")
        ) {
            return false;
        }

        return [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"].some((extension) =>
            normalizedUrl.includes(extension),
        );
    }
}
