import { getAdaptivePixelScale } from './adaptive-quality';

describe('viewer adaptive quality', () => {
    const options = {
        enabled: true,
        maxPixelScale: 1,
        minPixelScale: 0.5,
        interactionScaleFactor: 0.75,
    };

    it('keeps full resolution for large viewports', () => {
        expect(getAdaptivePixelScale(900, 600, options, false)).toBeCloseTo(1, 5);
    });

    it('reduces idle resolution for smaller viewports', () => {
        expect(getAdaptivePixelScale(420, 320, options, false)).toBeCloseTo(0.61, 2);
        expect(getAdaptivePixelScale(260, 220, options, false)).toBeCloseTo(0.55, 5);
    });

    it('drops resolution further while the user is interacting', () => {
        expect(getAdaptivePixelScale(420, 320, options, true)).toBeCloseTo(0.46, 2);
        expect(getAdaptivePixelScale(260, 220, options, true)).toBeCloseTo(0.41, 2);
    });

    it('respects configured bounds', () => {
        expect(getAdaptivePixelScale(900, 600, { ...options, maxPixelScale: 0.8 }, false)).toBeCloseTo(0.8, 5);
        expect(getAdaptivePixelScale(160, 160, { ...options, minPixelScale: 0.6 }, false)).toBeCloseTo(0.6, 5);
    });
});