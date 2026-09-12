import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlagIcon } from "@/components/ui/FlagIcon";
import LanguageSwitcher from "@/components/LanguageSwitcher";

// Mock next-intl & routing
vi.mock("next-intl", () => ({
  useLocale: () => "es",
}));

const mockReplace = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/dashboard",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=overview"),
}));

describe("FlagIcon Component (Cross-Platform SVG Flags)", () => {
  it("renders an SVG for Spain (ES) without relying on system emoji fonts", () => {
    const { container } = render(<FlagIcon locale="es" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 750 500");
  });

  it("renders an SVG for United States / English (EN)", () => {
    const { container } = render(<FlagIcon locale="en" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 741 390");
  });

  it("renders an SVG for Brazil / Portuguese (PT-BR)", () => {
    const { container } = render(<FlagIcon locale="pt-BR" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 720 504");
  });
});

describe("LanguageSwitcher Component", () => {
  it("renders the active flag and ISO code (ES) in the trigger button", () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole("button", { name: /seleccionar idioma/i });
    expect(trigger).toBeDefined();
    expect(trigger.textContent).toContain("ES");
    expect(trigger.querySelector("svg")).toBeTruthy();
  });

  it("renders with white text styling when variant='white' for login screen", () => {
    render(<LanguageSwitcher variant="white" />);
    const trigger = screen.getByRole("button", { name: /seleccionar idioma/i });
    expect(trigger.className).toContain("text-white");
  });

  it("opens the dropdown when clicked and lists ES, EN, and PT-BR with ISO codes", () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole("button", { name: /seleccionar idioma/i });
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);

    const texts = options.map((opt) => opt.textContent);
    expect(texts.some((t) => t?.includes("ES"))).toBe(true);
    expect(texts.some((t) => t?.includes("EN"))).toBe(true);
    expect(texts.some((t) => t?.includes("PT-BR"))).toBe(true);
  });

  it("navigates with next-intl router preserving query params when an option is clicked", () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole("button", { name: /seleccionar idioma/i });
    fireEvent.click(trigger);

    const enOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("EN"));
    expect(enOption).toBeDefined();

    fireEvent.click(enOption!);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard?tab=overview", { locale: "en" });
  });
});
