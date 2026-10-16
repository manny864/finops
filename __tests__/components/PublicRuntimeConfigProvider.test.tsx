import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PublicRuntimeConfigProvider, { usePublicRuntimeConfig } from "@/components/PublicRuntimeConfigProvider";
import { getPublicRuntimeConfig } from "@/lib/publicRuntimeConfig";
afterEach(cleanup);
function Consumer() {
  const config = usePublicRuntimeConfig();
  return <output>{config.clientId}:{config.paddleProMonthly}:{config.paddleClientToken}</output>;
}
describe("runtime config hydration", () => {
  it("uses only the server-provided values, not the test/browser build environment", () => {
    const config = getPublicRuntimeConfig({
      NEXT_PUBLIC_CLIENT_ID: "staging-client", NEXT_PUBLIC_PADDLE_PRO_MONTHLY: "pri_staging",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_staging",
    });
    const { rerender } = render(<PublicRuntimeConfigProvider config={config}><Consumer /></PublicRuntimeConfigProvider>);
    expect(screen.getByText("staging-client:pri_staging:test_staging")).toBeTruthy();
    rerender(<PublicRuntimeConfigProvider config={{ ...config, clientId: "prod-client", paddleProMonthly: "pri_prod", paddleClientToken: "live_prod" }}><Consumer /></PublicRuntimeConfigProvider>);
    expect(screen.getByText("prod-client:pri_prod:live_prod")).toBeTruthy();
  });
});
