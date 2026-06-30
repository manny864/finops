import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("RTL smoke", () => {
    it("renders a div", () => {
        render(<div data-testid="x">hello</div>);
        expect(screen.getByTestId("x").textContent).toBe("hello");
    });
});
