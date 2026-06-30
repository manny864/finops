import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Polyfills básicos para entorno jsdom
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as any;
}

if (typeof globalThis.matchMedia === "undefined" && typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

// Silenciar warnings de Next.js sobre Request/Response APIs en jsdom
if (typeof globalThis.Request === "undefined") {
    globalThis.Request = class {} as any;
}
if (typeof globalThis.Response === "undefined") {
    globalThis.Response = class {} as any;
}
