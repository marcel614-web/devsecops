// apps/web/src/test/setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Environnement de test du front.
 * - jest-dom pour les matchers DOM (toBeInTheDocument, ...)
 * - cleanup automatique entre les tests (évite les fuites de DOM)
 * - stub de matchMedia (utilisé par le store de thème et les breakpoints)
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
