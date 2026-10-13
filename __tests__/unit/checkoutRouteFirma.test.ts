// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: consultar } }));
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: vi.fn(async () => ({ email: "a@b.com" })) }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: vi.fn(async () => ({ allowed: true })) } }));

import { POST } from "@/app/api/checkout/route";
import { verificarVinculo } from "@/lib/checkoutBinding";

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const PRECIO = "pri_plan_professional_mensual";

const pedir = (cuerpo: Record<string, unknown>) =>
  POST(new NextRequest(`http://localhost/api/checkout?tenantId=${TENANT}`, { method: "POST", body: JSON.stringify(cuerpo) }));

beforeEach(() => {
  process.env.PADDLE_WEBHOOK_SECRET = "secreto-de-prueba";
  process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = PRECIO;
  consultar.mockReset().mockResolvedValue([[{ paddle_subscription_id: null }]]);
});
afterEach(() => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY;
});

describe("POST /api/checkout", () => {
  it("devuelve el precio del plan y un custom_data firmado para el tenant y ese precio", async () => {
    const j = await (await pedir({ tier: "Professional", billing: "monthly" })).json();
    expect(j.priceId).toBe(PRECIO);
    expect(verificarVinculo(j.customData, [PRECIO])).toMatchObject({ tenantId: TENANT, priceId: PRECIO });
  });

  it("un tenant que ya tiene suscripción no recibe un vínculo nuevo", async () => {
    consultar.mockResolvedValue([[{ paddle_subscription_id: "sub_x" }]]);
    const r = await pedir({ tier: "Professional", billing: "monthly" });
    expect(r.status).toBe(400);
  });
});
