import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportElementAsPng, exportElementAsSvg, exportElementAsPdf } from '@/lib/chartExport';
import * as htmlToImage from 'html-to-image';

// Polyfill para JSDOM
if (typeof (globalThis as any).SVGImageElement === 'undefined') {
    (globalThis as any).SVGImageElement = class SVGImageElement extends (globalThis.SVGElement || Object) {};
}

describe('chartExport utility', () => {
    let mockElement: HTMLElement;

    beforeEach(() => {
        mockElement = document.createElement('div');
        mockElement.innerHTML = `
            <svg class="recharts-surface" width="500" height="300" viewBox="0 0 500 300">
                <rect x="50" y="50" width="100" height="200" fill="#0054A6" />
                <text x="50" y="30">Compute</text>
            </svg>
            <div class="recharts-legend-wrapper">
                <span>Legend</span>
            </div>
        `;
        document.body.appendChild(mockElement);
    });

    it('exportElementAsPng triggers download with dataUrl', async () => {
        const dummyDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        vi.spyOn(htmlToImage, 'toPng').mockResolvedValue(dummyDataUrl);
        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
        const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await expect(exportElementAsPng(mockElement, 'test-chart.png')).resolves.not.toThrow();
        expect(createObjectURLSpy).toHaveBeenCalled();

        createObjectURLSpy.mockRestore();
        revokeObjectURLSpy.mockRestore();
    });

    it('exportElementAsSvg triggers download with svg content', async () => {
        const dummySvgDataUrl = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E';
        vi.spyOn(htmlToImage, 'toSvg').mockResolvedValue(dummySvgDataUrl);
        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-svg-url');
        const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await expect(exportElementAsSvg(mockElement, 'test-chart.svg')).resolves.not.toThrow();
        expect(createObjectURLSpy).toHaveBeenCalled();

        createObjectURLSpy.mockRestore();
        revokeObjectURLSpy.mockRestore();
    });

    it('exportElementAsPdf creates a jsPDF document with CSCloudSolutions header', async () => {
        const dummyDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        vi.spyOn(htmlToImage, 'toPng').mockResolvedValue(dummyDataUrl);
        await expect(exportElementAsPdf(mockElement, 'test-chart.pdf', 'Test Title', 'Test Subtitle')).resolves.not.toThrow();
    });
});

