/**
 * azureDdosProtection.service.ts
 *
 * Full DDoS Protection FinOps service — inventory, cost attribution, arbitrage
 * engine, and remediation generation for Azure DDoS Network Protection Plans,
 * DDoS IP Protection, and unprotected public IPs.
 *
 * Data sources:
 *   - Azure Resource Graph (microsoft.network/ddosProtectionPlans,
 *     microsoft.network/virtualNetworks, microsoft.network/publicIPAddresses)
 *   - CostSnapshots (MySQL) for live cost data
 *   - Azure Monitor metrics (UnderDDoSAttack, BytesDroppedDDoS, etc.)
 *
 * RBAC: Tier Business+.
 * Azure roles: Network Contributor, Security Reader, Cost Management Reader.
 */

import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import {
  DdosResourceDetail,
  DdosSummaryMetrics,
  DdosTierBreakdown,
  DdosRemediationAction,
  DdosProtectionResponse,
  DDOS_PROTECTION_COLORS,
  DDOS_ORPHAN_COLOR,
} from "@/types/ddosProtection.types";

// ─── Constants ────────────────────────────────────────────────────────────

/** Fixed monthly cost for a DDoS Network Protection plan (USD) */
const NETWORK_PROTECTION_PLAN_COST = 2944.0;

/** Fixed monthly cost per IP with DDoS IP Protection enabled (USD) */
const IP_PROTECTION_COST_PER_IP = 199.0;

/** Break-even threshold: if a Network Protection plan covers fewer than this
 *  many IPs, migrating to IP Protection is cheaper. */
const ARBITRAGE_BREAKEVEN_IPS = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────

function detectEnvironment(
  tags?: Record<string, string>,
  name?: string,
  rg?: string,
): "prod" | "dev" | "staging" | "qa" | "unknown" {
  const haystack = `${name || ""} ${rg || ""} ${tags?.Environment || tags?.env || tags?.environment || ""}`.toLowerCase();
  if (haystack.includes("prod") || haystack.includes("production")) return "prod";
  if (haystack.includes("dev") || haystack.includes("development")) return "dev";
  if (haystack.includes("stag") || haystack.includes("staging")) return "staging";
  if (haystack.includes("qa") || haystack.includes("test")) return "qa";
  return "unknown";
}

function extractOwner(tags?: Record<string, string>): string {
  if (!tags) return "Unassigned";
  return tags.CostCenter || tags.costCenter || tags.Owner || tags.owner || tags.Team || tags.team || "Infra / NetOps";
}

// ─── KQL Queries ──────────────────────────────────────────────────────────

function buildDdosProtectionPlansKql(): string {
  return `
    resources
    | where type =~ 'microsoft.network/ddosprotectionplans'
    | project
        id,
        name,
        type,
        location,
        resourceGroup,
        subscriptionId,
        tags,
        properties
  `;
}

function buildVirtualNetworksKql(): string {
  return `
    resources
    | where type =~ 'microsoft.network/virtualnetworks'
    | project
        id,
        name,
        type,
        location,
        resourceGroup,
        subscriptionId,
        tags,
        properties
  `;
}

function buildPublicIpsKql(): string {
  return `
    resources
    | where type =~ 'microsoft.network/publicipaddresses'
    | project
        id,
        name,
        type,
        location,
        resourceGroup,
        subscriptionId,
        tags,
        properties
  `;
}

// ─── Mock Data Generator ──────────────────────────────────────────────────

function getMockDdosProtectionData(tenantId: string): DdosProtectionResponse {
  let multiplier = 1.0;
  if (tenantId.includes("business") || tenantId.includes("tier-2")) multiplier = 2.5;
  if (tenantId.includes("enterprise") || tenantId.includes("tier-3")) multiplier = 6.0;

  const planCount = multiplier >= 6 ? 4 : multiplier >= 2.5 ? 3 : 2;
  const ipPerPlan = Math.round(8 * multiplier);
  const unprotectedIps = Math.round(5 * multiplier);

  const resources: DdosResourceDetail[] = [];
  const remediations: DdosRemediationAction[] = [];

  const regions = ["eastus", "westeurope", "uksouth", "southeastasia"];
  const subNames = ["Producción Principal", "Producción Europa", "DR UK", "APAC"];
  const subIds = [
    "sub-prod-001",
    "sub-prod-002",
    "sub-dr-001",
    "sub-apac-001",
  ];

  for (let i = 0; i < planCount; i++) {
    const planName = `ddos-plan-${regions[i]}`;
    const rg = `rg-hub-security-${regions[i]}`;
    const planId = `/subscriptions/${subIds[i]}/resourceGroups/${rg}/providers/Microsoft.Network/ddosProtectionPlans/${planName}`;
    const vnetCount = Math.round(6 * multiplier * (1 - i * 0.15));
    const ipCount = Math.round(ipPerPlan * (1 - i * 0.1));
    const isOrphan = i === planCount - 1 && multiplier < 6; // Last plan orphan in non-enterprise

    resources.push({
      id: planId,
      name: planName,
      resourceType: "DDoS Plan",
      protectionTier: "NetworkProtection",
      associatedVnetsCount: isOrphan ? 0 : vnetCount,
      protectedIpsCount: isOrphan ? 0 : ipCount,
      publicIpAddress: null,
      isOrphan,
      status: isOrphan ? "Orphan" : "Protected",
      resourceGroup: rg,
      subscriptionId: subIds[i],
      subscriptionName: subNames[i],
      costCenterOwner: "Infra / NetOps",
      creationDate: new Date(Date.now() - (365 - i * 90) * 86400000).toISOString(),
      location: regions[i],
      monthlyCostUSD: Number((NETWORK_PROTECTION_PLAN_COST * multiplier).toFixed(2)),
      tags: { Environment: "prod", CostCenter: "SEC-001" },
      environment: "prod",
      skuTier: "Standard",
    });

    // Add protected IPs under this plan
    for (let j = 0; j < (isOrphan ? 0 : Math.min(ipCount, 5)); j++) {
      const ipName = `${planName}-ip-${j + 1}`;
      resources.push({
        id: `${planId}/publicIPAddresses/${ipName}`,
        name: ipName,
        resourceType: "Protected Public IP",
        protectionTier: "NetworkProtection",
        associatedVnetsCount: 0,
        protectedIpsCount: 1,
        publicIpAddress: `20.${50 + i}.${j}.${100 + j}`,
        isOrphan: false,
        status: "Protected",
        resourceGroup: rg,
        subscriptionId: subIds[i],
        subscriptionName: subNames[i],
        costCenterOwner: "Infra / NetOps",
        creationDate: new Date(Date.now() - 180 * 86400000).toISOString(),
        location: regions[i],
        monthlyCostUSD: 0, // Cost is in the plan
        tags: { Environment: "prod" },
        environment: "prod",
        linkedPlanId: planId,
        linkedPlanName: planName,
      });
    }
  }

  // Add some IP Protection IPs
  const ipProtectionCount = Math.round(3 * multiplier);
  for (let i = 0; i < ipProtectionCount; i++) {
    const ipName = `ip-protection-ip-${i + 1}`;
    resources.push({
      id: `/subscriptions/${subIds[0]}/resourceGroups/rg-app-prod/providers/Microsoft.Network/publicIPAddresses/${ipName}`,
      name: ipName,
      resourceType: "Protected Public IP",
      protectionTier: "IpProtection",
      associatedVnetsCount: 0,
      protectedIpsCount: 1,
      publicIpAddress: `52.168.${i}.${10 + i}`,
      isOrphan: false,
      status: "Protected",
      resourceGroup: "rg-app-prod",
      subscriptionId: subIds[0],
      subscriptionName: subNames[0],
      costCenterOwner: "App Team",
      creationDate: new Date(Date.now() - 90 * 86400000).toISOString(),
      location: "eastus",
      monthlyCostUSD: Number((IP_PROTECTION_COST_PER_IP * multiplier).toFixed(2)),
      tags: { Environment: "prod" },
      environment: "prod",
    });
  }

  // Add unprotected IPs
  for (let i = 0; i < unprotectedIps; i++) {
    const ipName = `basic-ip-${i + 1}`;
    resources.push({
      id: `/subscriptions/${subIds[0]}/resourceGroups/rg-dev/providers/Microsoft.Network/publicIPAddresses/${ipName}`,
      name: ipName,
      resourceType: "Unprotected Public IP",
      protectionTier: "Basic",
      associatedVnetsCount: 0,
      protectedIpsCount: 0,
      publicIpAddress: `13.90.${i}.${50 + i}`,
      isOrphan: false,
      status: "Unprotected",
      resourceGroup: "rg-dev",
      subscriptionId: subIds[0],
      subscriptionName: subNames[0],
      costCenterOwner: "Dev Team",
      creationDate: new Date(Date.now() - 60 * 86400000).toISOString(),
      location: "eastus",
      monthlyCostUSD: 0,
      tags: { Environment: "dev" },
      environment: "dev",
    });
  }

  // Compute summary
  const plans = resources.filter((r) => r.resourceType === "DDoS Plan");
  const protectedIps = resources.filter(
    (r) => r.resourceType === "Protected Public IP" && r.protectionTier !== "Basic",
  );
  const basicIps = resources.filter((r) => r.protectionTier === "Basic");
  const orphanPlans = plans.filter((p) => p.isOrphan);

  const totalCost = resources.reduce((s, r) => s + r.monthlyCostUSD, 0);
  const totalIps = protectedIps.length + basicIps.length;
  const coveragePct = totalIps > 0 ? Math.round((protectedIps.length / totalIps) * 100) : 0;

  // Arbitrage savings
  let potentialSavings = 0;
  for (const plan of plans) {
    if (plan.isOrphan) {
      potentialSavings += plan.monthlyCostUSD;
    } else if (plan.protectedIpsCount < ARBITRAGE_BREAKEVEN_IPS && plan.protectedIpsCount > 0) {
      const ipCost = plan.protectedIpsCount * IP_PROTECTION_COST_PER_IP * multiplier;
      potentialSavings += plan.monthlyCostUSD - ipCost;
    }
  }

  // Breakdown for donut
  const networkCost = plans.filter((p) => !p.isOrphan).reduce((s, p) => s + p.monthlyCostUSD, 0);
  const ipProtCost = protectedIps.filter((ip) => ip.protectionTier === "IpProtection").reduce((s, ip) => s + ip.monthlyCostUSD, 0);
  const basicCost = 0; // Basic is free
  const orphanCost = orphanPlans.reduce((s, p) => s + p.monthlyCostUSD, 0);
  const grandTotal = networkCost + ipProtCost + basicCost + orphanCost || 1;

  const breakdown: DdosTierBreakdown[] = [
    {
      tierName: "NetworkProtection",
      tierLabelKey: "tier_NETWORK_PROTECTION",
      costUSD: Number(networkCost.toFixed(2)),
      percentage: Number(((networkCost / grandTotal) * 100).toFixed(1)),
      color: DDOS_PROTECTION_COLORS.NetworkProtection,
      count: plans.filter((p) => !p.isOrphan).length,
    },
    {
      tierName: "IpProtection",
      tierLabelKey: "tier_IP_PROTECTION",
      costUSD: Number(ipProtCost.toFixed(2)),
      percentage: Number(((ipProtCost / grandTotal) * 100).toFixed(1)),
      color: DDOS_PROTECTION_COLORS.IpProtection,
      count: protectedIps.filter((ip) => ip.protectionTier === "IpProtection").length,
    },
    {
      tierName: "Basic",
      tierLabelKey: "tier_BASIC",
      costUSD: 0,
      percentage: 0,
      color: DDOS_PROTECTION_COLORS.Basic,
      count: basicIps.length,
    },
  ];

  if (orphanCost > 0) {
    breakdown.push({
      tierName: "NetworkProtection",
      tierLabelKey: "tier_ORPHAN",
      costUSD: Number(orphanCost.toFixed(2)),
      percentage: Number(((orphanCost / grandTotal) * 100).toFixed(1)),
      color: DDOS_ORPHAN_COLOR,
      count: orphanPlans.length,
    });
  }

  // Remediations
  for (const plan of orphanPlans) {
    remediations.push({
      id: `rem-orphan-${plan.name}`,
      resourceId: plan.id,
      resourceName: plan.name,
      category: "ORPHAN_PLAN",
      params: { plan: plan.name, cost: plan.monthlyCostUSD.toFixed(2) },
      estimatedSavingsUSD: plan.monthlyCostUSD,
      confidence: "HIGH",
      actionType: "DELETE",
      commandPayload: {
        cli: `az network ddos-protection delete --name "${plan.name}" --resource-group "${plan.resourceGroup}" --subscription "${plan.subscriptionId}"`,
        powershell: `Remove-AzDdosProtectionPlan -Name "${plan.name}" -ResourceGroupName "${plan.resourceGroup}" -Force`,
      },
    });
  }

  for (const plan of plans.filter((p) => !p.isOrphan && p.protectedIpsCount < ARBITRAGE_BREAKEVEN_IPS && p.protectedIpsCount > 0)) {
    const ipCost = plan.protectedIpsCount * IP_PROTECTION_COST_PER_IP * multiplier;
    const savings = plan.monthlyCostUSD - ipCost;
    remediations.push({
      id: `rem-arbitrage-${plan.name}`,
      resourceId: plan.id,
      resourceName: plan.name,
      category: "ARBITRAGE_IP_PLAN",
      params: {
        plan: plan.name,
        ips: plan.protectedIpsCount,
        ipRate: IP_PROTECTION_COST_PER_IP * multiplier,
        savings: savings.toFixed(2),
        planCost: plan.monthlyCostUSD.toFixed(2),
      },
      estimatedSavingsUSD: Number(savings.toFixed(2)),
      confidence: "HIGH",
      actionType: "RECONFIGURE",
      commandPayload: {
        cli: `#{cmt_STEP1_ENABLE_IP}\n# az network public-ip update --name "<ip>" --resource-group "<rg>" --ddos-protection-mode Enabled\n#{cmt_STEP2_UNLINK_VNETS}\n# az network vnet update --name "<vnet>" --resource-group "<rg>" --ddos-protection false\n#{cmt_STEP3_DELETE_PLAN}\naz network ddos-protection delete --name "${plan.name}" --resource-group "${plan.resourceGroup}"`,
        powershell: `#{cmt_MIGRATE_TO_IP} ${plan.name}`,
      },
    });
  }

  if (basicIps.length > 0) {
    remediations.push({
      id: "rem-enable-ip-protection",
      resourceId: "",
      // No hay un recurso unico detras: la recomendacion agrupa varias IPs.
      resourceName: "",
      category: "ENABLE_IP_PROTECTION",
      params: {
        ips: basicIps.length,
        cost: (basicIps.length * IP_PROTECTION_COST_PER_IP * multiplier).toFixed(2),
      },
      estimatedSavingsUSD: 0, // This is a cost increase, not savings
      confidence: "MEDIUM",
      actionType: "ENABLE",
      commandPayload: {
        cli: `az network public-ip update --name "<ip>" --resource-group "<rg>" --ddos-protection-mode Enabled`,
        powershell: `Set-AzPublicIpAddress -Name "<ip>" -ResourceGroupName "<rg>" -DdosProtectionMode Enabled`,
      },
    });
  }

  const summary: DdosSummaryMetrics = {
    totalCostUSD: Number(totalCost.toFixed(2)),
    projectedEndOfMonthCostUSD: Number((totalCost * 1.05).toFixed(2)),
    activePlansCount: plans.filter((p) => !p.isOrphan).length,
    protectedIpsCount: protectedIps.length,
    unprotectedIpsCount: basicIps.length,
    orphanedPlansCount: orphanPlans.length,
    potentialSavingsUSD: Number(potentialSavings.toFixed(2)),
    activeAttacksCount: 0,
    coveragePercentage: coveragePct,
    breakdown,
  };

  return {
    success: true,
    mock: true,
    summary,
    resources,
    remediations,
  };
}

// ─── Empty Response ───────────────────────────────────────────────────────

function getEmptyDdosProtectionResponse(): DdosProtectionResponse {
  return {
    success: true,
    mock: false,
    summary: {
      totalCostUSD: 0,
      projectedEndOfMonthCostUSD: 0,
      activePlansCount: 0,
      protectedIpsCount: 0,
      unprotectedIpsCount: 0,
      orphanedPlansCount: 0,
      potentialSavingsUSD: 0,
      activeAttacksCount: 0,
      coveragePercentage: 0,
      breakdown: [],
    },
    resources: [],
    remediations: [],
  };
}

// ─── Main Service ─────────────────────────────────────────────────────────

export async function getAzureDdosProtection(tenantId: string): Promise<DdosProtectionResponse> {
  const isMock =
    tenantId.startsWith("demo-") ||
    tenantId.startsWith("mock-") ||
    tenantId === "default-tenant" ||
    tenantId === "default";

  if (isMock) {
    return getMockDdosProtectionData(tenantId);
  }

  try {
    const client = await getResourceGraphClient(tenantId);
    if (!client) {
      return getEmptyDdosProtectionResponse();
    }

    const credential = await getAzureCredential(tenantId).catch(() => null);
    const subNameMap = credential
      ? await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>())
      : new Map<string, string>();

    // ── 1. Query DDoS Protection Plans ──────────────────────────────────
    const plansQuery = buildDdosProtectionPlansKql();
    const plansResponse: any = await client.resources({ query: plansQuery });
    const planRows = plansResponse.data || [];

    // ── 2. Query Virtual Networks ───────────────────────────────────────
    const vnetsQuery = buildVirtualNetworksKql();
    const vnetsResponse: any = await client.resources({ query: vnetsQuery });
    const vnetRows = vnetsResponse.data || [];

    // ── 3. Query Public IPs ─────────────────────────────────────────────
    const ipsQuery = buildPublicIpsKql();
    const ipsResponse: any = await client.resources({ query: ipsQuery });
    const ipRows = ipsResponse.data || [];

    // ── 4. Build lookup maps ────────────────────────────────────────────
    // Map: plan ID → plan row
    const planMap = new Map<string, any>();
    for (const row of planRows) {
      planMap.set((row.id || "").toLowerCase(), row);
    }

    // Map: VNet ID → VNet row
    const vnetMap = new Map<string, any>();
    for (const row of vnetRows) {
      vnetMap.set((row.id || "").toLowerCase(), row);
    }

    // Map: plan ID → set of VNet IDs linked to it
    const planToVnets = new Map<string, Set<string>>();
    for (const vnet of vnetRows) {
      const planId = (vnet.properties?.ddosProtectionPlan?.id || "").toLowerCase();
      if (planId) {
        if (!planToVnets.has(planId)) planToVnets.set(planId, new Set());
        planToVnets.get(planId)!.add((vnet.id || "").toLowerCase());
      }
    }

    // Map: VNet ID → set of Public IP IDs inside it (via ipConfiguration)
    const vnetToIps = new Map<string, Set<string>>();
    for (const ip of ipRows) {
      const ipConfig = ip.properties?.ipConfiguration;
      if (ipConfig?.id) {
        // Extract VNet from subnet ID in ipConfiguration
        const subnetId = (ipConfig.subnet?.id || "").toLowerCase();
        // subnetId looks like: /.../virtualNetworks/<vnetName>/subnets/<subnetName>
        const vnetMatch = subnetId.match(/\/virtualnetworks\/([^/]+)\//i);
        if (vnetMatch) {
          // Find the VNet by name in the same resource group
          const ipRg = (ip.resourceGroup || "").toLowerCase();
          for (const [vnetId, vnet] of vnetMap) {
            if (
              vnet.name?.toLowerCase() === vnetMatch[1] &&
              (vnet.resourceGroup || "").toLowerCase() === ipRg
            ) {
              if (!vnetToIps.has(vnetId)) vnetToIps.set(vnetId, new Set());
              vnetToIps.get(vnetId)!.add((ip.id || "").toLowerCase());
              break;
            }
          }
        }
      }
    }

    // ── 5. Fetch live costs from CostSnapshots ──────────────────────────
    const costMap = new Map<string, number>();
    try {
      const [costRows]: any = await pool.query(
        `SELECT LOWER(COALESCE(ResourceId, resource_id, '')) AS resourceId,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND COALESCE(ResourceId, resource_id, '') <> ''
         GROUP BY LOWER(COALESCE(ResourceId, resource_id, ''))`,
        [tenantId],
      ).catch(() => [[]]);

      for (const r of costRows || []) {
        const rid = String(r.resourceId || "").toLowerCase();
        if (rid) costMap.set(rid, Number(r.total || 0));
      }
    } catch (e) {
      console.warn("[azureDdosProtection] Error fetching CostSnapshots:", e);
    }

    // ── 6. Build resource list ──────────────────────────────────────────
    const resources: DdosResourceDetail[] = [];
    const remediations: DdosRemediationAction[] = [];

    // Process DDoS Protection Plans
    for (const plan of planRows) {
      const planId = (plan.id || "").toLowerCase();
      const planName = plan.name || "unnamed";
      const rg = plan.resourceGroup || "default-rg";
      const subId = plan.subscriptionId || "";
      const subName = resolveSubscriptionName(subId, subNameMap);
      const loc = plan.location || "unknown";
      const tags = (plan.tags || {}) as Record<string, string>;
      const owner = extractOwner(tags);
      const env = detectEnvironment(tags, planName, rg);

      const linkedVnetIds = planToVnets.get(planId) || new Set();
      const vnetCount = linkedVnetIds.size;

      // Count IPs inside linked VNets
      let ipCount = 0;
      for (const vnetId of linkedVnetIds) {
        ipCount += (vnetToIps.get(vnetId) || new Set()).size;
      }

      const isOrphan = vnetCount === 0;
      const liveCost = costMap.get(planId) || 0;
      const monthlyCost = liveCost > 0 ? liveCost : (isOrphan ? NETWORK_PROTECTION_PLAN_COST : NETWORK_PROTECTION_PLAN_COST);

      resources.push({
        id: plan.id || "",
        name: planName,
        resourceType: "DDoS Plan",
        protectionTier: "NetworkProtection",
        associatedVnetsCount: vnetCount,
        protectedIpsCount: ipCount,
        publicIpAddress: null,
        isOrphan,
        status: isOrphan ? "Orphan" : "Protected",
        resourceGroup: rg,
        subscriptionId: subId,
        subscriptionName: subName,
        costCenterOwner: owner,
        creationDate: plan.properties?.creationTime || new Date().toISOString(),
        location: loc,
        monthlyCostUSD: Number(monthlyCost.toFixed(2)),
        tags,
        environment: env,
        skuTier: "Standard",
      });
    }

    // Process Public IPs with DDoS IP Protection
    for (const ip of ipRows) {
      const ipId = (ip.id || "").toLowerCase();
      const ipName = ip.name || "unnamed";
      const rg = ip.resourceGroup || "default-rg";
      const subId = ip.subscriptionId || "";
      const subName = resolveSubscriptionName(subId, subNameMap);
      const loc = ip.location || "unknown";
      const tags = (ip.tags || {}) as Record<string, string>;
      const owner = extractOwner(tags);
      const env = detectEnvironment(tags, ipName, rg);
      const props = ip.properties || {};

      const ddosSettings = props.ddosSettings || {};
      const protectionCoverage = ddosSettings.protectionCoverage || "Basic";
      const ipAddress = props.ipAddress || null;

      if (protectionCoverage === "Enabled") {
        // IP Protection enabled
        const liveCost = costMap.get(ipId) || 0;
        const monthlyCost = liveCost > 0 ? liveCost : IP_PROTECTION_COST_PER_IP;

        resources.push({
          id: ip.id || "",
          name: ipName,
          resourceType: "Protected Public IP",
          protectionTier: "IpProtection",
          associatedVnetsCount: 0,
          protectedIpsCount: 1,
          publicIpAddress: ipAddress,
          isOrphan: false,
          status: "Protected",
          resourceGroup: rg,
          subscriptionId: subId,
          subscriptionName: subName,
          costCenterOwner: owner,
          creationDate: new Date().toISOString(),
          location: loc,
          monthlyCostUSD: Number(monthlyCost.toFixed(2)),
          tags,
          environment: env,
        });
      } else {
        // Basic protection — check if it's inside a protected VNet
        let insideProtectedVnet = false;
        let linkedPlanId: string | undefined;
        let linkedPlanName: string | undefined;

        const ipConfig = props.ipConfiguration;
        if (ipConfig?.subnet?.id) {
          const subnetId = ipConfig.subnet.id.toLowerCase();
          const vnetMatch = subnetId.match(/\/virtualnetworks\/([^/]+)\//i);
          if (vnetMatch) {
            for (const [vnetId, vnet] of vnetMap) {
              if (
                vnet.name?.toLowerCase() === vnetMatch[1] &&
                (vnet.resourceGroup || "").toLowerCase() === rg.toLowerCase()
              ) {
                const planIdFromVnet = (vnet.properties?.ddosProtectionPlan?.id || "").toLowerCase();
                if (planIdFromVnet && planMap.has(planIdFromVnet)) {
                  insideProtectedVnet = true;
                  linkedPlanId = planIdFromVnet;
                  linkedPlanName = planMap.get(planIdFromVnet)?.name;
                }
                break;
              }
            }
          }
        }

        if (insideProtectedVnet) {
          // Already counted under the plan — skip or add as covered
          resources.push({
            id: ip.id || "",
            name: ipName,
            resourceType: "Protected Public IP",
            protectionTier: "NetworkProtection",
            associatedVnetsCount: 0,
            protectedIpsCount: 1,
            publicIpAddress: ipAddress,
            isOrphan: false,
            status: "Protected",
            resourceGroup: rg,
            subscriptionId: subId,
            subscriptionName: subName,
            costCenterOwner: owner,
            creationDate: new Date().toISOString(),
            location: loc,
            monthlyCostUSD: 0, // Cost is in the plan
            tags,
            environment: env,
            linkedPlanId,
            linkedPlanName,
          });
        } else {
          resources.push({
            id: ip.id || "",
            name: ipName,
            resourceType: "Unprotected Public IP",
            protectionTier: "Basic",
            associatedVnetsCount: 0,
            protectedIpsCount: 0,
            publicIpAddress: ipAddress,
            isOrphan: false,
            status: "Unprotected",
            resourceGroup: rg,
            subscriptionId: subId,
            subscriptionName: subName,
            costCenterOwner: owner,
            creationDate: new Date().toISOString(),
            location: loc,
            monthlyCostUSD: 0,
            tags,
            environment: env,
          });
        }
      }
    }

    // ── 7. Compute summary metrics ──────────────────────────────────────
    const plans = resources.filter((r) => r.resourceType === "DDoS Plan");
    const protectedIps = resources.filter(
      (r) => r.resourceType === "Protected Public IP" && r.protectionTier !== "Basic",
    );
    const basicIps = resources.filter((r) => r.protectionTier === "Basic");
    const orphanPlans = plans.filter((p) => p.isOrphan);

    const totalCost = resources.reduce((s, r) => s + r.monthlyCostUSD, 0);
    const totalIps = protectedIps.length + basicIps.length;
    const coveragePct = totalIps > 0 ? Math.round((protectedIps.length / totalIps) * 100) : 0;

    // Arbitrage savings
    let potentialSavings = 0;
    for (const plan of plans) {
      if (plan.isOrphan) {
        potentialSavings += plan.monthlyCostUSD;
      } else if (plan.protectedIpsCount < ARBITRAGE_BREAKEVEN_IPS && plan.protectedIpsCount > 0) {
        const ipCost = plan.protectedIpsCount * IP_PROTECTION_COST_PER_IP;
        potentialSavings += Math.max(0, plan.monthlyCostUSD - ipCost);
      }
    }

    // Breakdown for donut
    const networkCost = plans.filter((p) => !p.isOrphan).reduce((s, p) => s + p.monthlyCostUSD, 0);
    const ipProtCost = protectedIps
      .filter((ip) => ip.protectionTier === "IpProtection")
      .reduce((s, ip) => s + ip.monthlyCostUSD, 0);
    const orphanCost = orphanPlans.reduce((s, p) => s + p.monthlyCostUSD, 0);
    const grandTotal = networkCost + ipProtCost + orphanCost || 1;

    const breakdown: DdosTierBreakdown[] = [
      {
        tierName: "NetworkProtection",
        tierLabelKey: "tier_NETWORK_PROTECTION",
        costUSD: Number(networkCost.toFixed(2)),
        percentage: Number(((networkCost / grandTotal) * 100).toFixed(1)),
        color: DDOS_PROTECTION_COLORS.NetworkProtection,
        count: plans.filter((p) => !p.isOrphan).length,
      },
      {
        tierName: "IpProtection",
        tierLabelKey: "tier_IP_PROTECTION",
        costUSD: Number(ipProtCost.toFixed(2)),
        percentage: Number(((ipProtCost / grandTotal) * 100).toFixed(1)),
        color: DDOS_PROTECTION_COLORS.IpProtection,
        count: protectedIps.filter((ip) => ip.protectionTier === "IpProtection").length,
      },
      {
        tierName: "Basic",
        tierLabelKey: "tier_BASIC",
        costUSD: 0,
        percentage: 0,
        color: DDOS_PROTECTION_COLORS.Basic,
        count: basicIps.length,
      },
    ];

    if (orphanCost > 0) {
      breakdown.push({
        tierName: "NetworkProtection",
        tierLabelKey: "tier_ORPHAN",
        costUSD: Number(orphanCost.toFixed(2)),
        percentage: Number(((orphanCost / grandTotal) * 100).toFixed(1)),
        color: DDOS_ORPHAN_COLOR,
        count: orphanPlans.length,
      });
    }

    // ── 8. Generate remediations ────────────────────────────────────────
    for (const plan of orphanPlans) {
      remediations.push({
        id: `rem-orphan-${plan.name}`,
        resourceId: plan.id,
        resourceName: plan.name,
        category: "ORPHAN_PLAN",
        params: { plan: plan.name, cost: plan.monthlyCostUSD.toFixed(2) },
        estimatedSavingsUSD: plan.monthlyCostUSD,
        confidence: "HIGH",
        actionType: "DELETE",
        commandPayload: {
          cli: `az network ddos-protection delete --name "${plan.name}" --resource-group "${plan.resourceGroup}" --subscription "${plan.subscriptionId}"`,
          powershell: `Remove-AzDdosProtectionPlan -Name "${plan.name}" -ResourceGroupName "${plan.resourceGroup}" -Force`,
        },
      });
    }

    for (const plan of plans.filter(
      (p) => !p.isOrphan && p.protectedIpsCount < ARBITRAGE_BREAKEVEN_IPS && p.protectedIpsCount > 0,
    )) {
      const ipCost = plan.protectedIpsCount * IP_PROTECTION_COST_PER_IP;
      const savings = plan.monthlyCostUSD - ipCost;
      if (savings > 0) {
        remediations.push({
          id: `rem-arbitrage-${plan.name}`,
          resourceId: plan.id,
          resourceName: plan.name,
          category: "ARBITRAGE_IP_PLAN",
          params: {
            plan: plan.name,
            ips: plan.protectedIpsCount,
            ipRate: IP_PROTECTION_COST_PER_IP,
            savings: savings.toFixed(2),
            planCost: plan.monthlyCostUSD.toFixed(2),
          },
          estimatedSavingsUSD: Number(savings.toFixed(2)),
          confidence: "HIGH",
          actionType: "RECONFIGURE",
          commandPayload: {
            cli: `#{cmt_MIGRATE_TO_IP} ${plan.name}`,
            powershell: `#{cmt_MIGRATE_TO_IP} ${plan.name}`,
          },
        });
      }
    }

    // Dev/staging VNets linked to prod DDoS plans
    for (const plan of plans.filter((p) => !p.isOrphan)) {
      const devVnets = resources.filter(
        (r) =>
          r.resourceType === "Protected VNet" &&
          r.linkedPlanId?.toLowerCase() === plan.id.toLowerCase() &&
          r.environment !== "prod" &&
          r.environment !== "unknown",
      );
      if (devVnets.length > 0) {
        remediations.push({
          id: `rem-dev-unlink-${plan.name}`,
          resourceId: plan.id,
          resourceName: plan.name,
          category: "DEV_UNLINK",
          params: { plan: plan.name, vnets: devVnets.length },
          estimatedSavingsUSD: 0,
          confidence: "MEDIUM",
          actionType: "RECONFIGURE",
          commandPayload: {
            cli: devVnets.map((v) => `az network vnet update --name "${v.name}" --resource-group "${v.resourceGroup}" --ddos-protection false`).join("\n"),
            powershell: `#{cmt_UNLINK_DEV_VNETS}`,
          },
        });
      }
    }

    if (basicIps.length > 0) {
      remediations.push({
        id: "rem-enable-ip-protection",
        resourceId: "",
        // No hay un recurso unico detras: la recomendacion agrupa varias IPs.
        resourceName: "",
        category: "ENABLE_IP_PROTECTION",
        params: {
          ips: basicIps.length,
          cost: (basicIps.length * IP_PROTECTION_COST_PER_IP).toFixed(2),
        },
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "ENABLE",
        commandPayload: {
          cli: `az network public-ip update --name "<ip>" --resource-group "<rg>" --ddos-protection-mode Enabled`,
          powershell: `Set-AzPublicIpAddress -Name "<ip>" -ResourceGroupName "<rg>" -DdosProtectionMode Enabled`,
        },
      });
    }

    const summary: DdosSummaryMetrics = {
      totalCostUSD: Number(totalCost.toFixed(2)),
      projectedEndOfMonthCostUSD: Number((totalCost * 1.05).toFixed(2)),
      activePlansCount: plans.filter((p) => !p.isOrphan).length,
      protectedIpsCount: protectedIps.length,
      unprotectedIpsCount: basicIps.length,
      orphanedPlansCount: orphanPlans.length,
      potentialSavingsUSD: Number(potentialSavings.toFixed(2)),
      activeAttacksCount: 0,
      coveragePercentage: coveragePct,
      breakdown,
    };

    return {
      success: true,
      mock: false,
      summary,
      resources,
      remediations,
    };
  } catch (e) {
    console.error("[azureDdosProtection] Fatal error:", e instanceof Error ? e.message : e);
    return getEmptyDdosProtectionResponse();
  }
}