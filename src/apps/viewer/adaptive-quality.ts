export type AdaptiveQualityOptions = {
    enabled: boolean;
    maxPixelScale: number;
    minPixelScale: number;
    interactionScaleFactor: number;
};

const TARGET_VIEWPORT_AREA = 360_000;
const MIN_VIEWPORT_SCALE_FACTOR = 0.55;
const MIN_INTERACTION_PIXEL_SCALE = 0.35;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function getAdaptivePixelScale(width: number, height: number, options: AdaptiveQualityOptions, isInteracting: boolean) {
    const maxPixelScale = Math.max(options.maxPixelScale, 0.1);
    const minPixelScale = clamp(options.minPixelScale, 0.1, maxPixelScale);

    if (!options.enabled || width <= 0 || height <= 0) {
        return maxPixelScale;
    }

    const areaFactor = clamp(Math.sqrt((width * height) / TARGET_VIEWPORT_AREA), MIN_VIEWPORT_SCALE_FACTOR, 1);
    const minDimensionFactor = clamp(Math.min(width, height) / 360, MIN_VIEWPORT_SCALE_FACTOR, 1);

    let nextPixelScale = maxPixelScale * Math.min(areaFactor, minDimensionFactor);
    if (isInteracting) nextPixelScale *= options.interactionScaleFactor;

    const lowerBound = isInteracting
        ? Math.max(MIN_INTERACTION_PIXEL_SCALE, minPixelScale * options.interactionScaleFactor)
        : minPixelScale;

    return clamp(nextPixelScale, lowerBound, maxPixelScale);
}