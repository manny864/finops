import { redis } from "@/lib/redis";

export type CostAvailabilityStatus = "available" | "unavailable" | "unknown";

export interface SubscriptionCostAvailability {
  status: CostAvailabilityStatus;
  reason?: string;
  updatedAt: string;
}

function key(tenantId: string, subscriptionId: string): string {
  return `cost:availability:v1:${tenantId}:${subscriptionId.toLowerCase()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function isCostUnavailableError(code: unknown, message: unknown): boolean {
  const c = String(code || "").toLowerCase();
  const m = String(message || "").toLowerCase();
  return (
    c.includes("subscriptioncostdisabled") ||
    m.includes("does not have the privilege to see the cost") ||
    m.includes("not enabled for cost management") ||
    m.includes("cost management is not supported") ||
    m.includes("offer type is not supported") ||
    m.includes("sponsorship")
  );
}

export async function markSubscriptionCostUnavailable(
  tenantId: string,
  subscriptionId: string,
  reason: string
): Promise<void> {
  try {
    const payload: SubscriptionCostAvailability = {
      status: "unavailable",
      reason,
      updatedAt: nowIso(),
    };
    await redis.set(key(tenantId, subscriptionId), JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch {
    // best-effort cache
  }
}

export async function markSubscriptionCostAvailable(
  tenantId: string,
  subscriptionId: string
): Promise<void> {
  try {
    const payload: SubscriptionCostAvailability = {
      status: "available",
      updatedAt: nowIso(),
    };
    await redis.set(key(tenantId, subscriptionId), JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch {
    // best-effort cache
  }
}

export async function getSubscriptionCostAvailabilityMap(
  tenantId: string,
  subscriptionIds: string[]
): Promise<Record<string, SubscriptionCostAvailability>> {
  const out: Record<string, SubscriptionCostAvailability> = {};
  await Promise.all(
    subscriptionIds.map(async (subscriptionId) => {
      try {
        const raw = await redis.get(key(tenantId, subscriptionId));
        if (!raw) return;
        const parsed = JSON.parse(raw) as SubscriptionCostAvailability;
        if (!parsed?.status) return;
        out[subscriptionId] = parsed;
      } catch {
        // best-effort cache
      }
    })
  );
  return out;
}
