import { describe, it, expect } from "vitest";
import {
  formatNetworkZombieType,
  computeNetworkingZombiesSummary,
  getMockNetworkingZombiesPayload,
  assembleLiveNetworkingZombies,
} from "@/services/azureNetworkingZombies.service";
import {
  NetworkZombieResourceItem,
  PrivateEndpointDetailItem,
} from "@/types/azureNetworkingZombies.types";

describe("Azure Networking Zombies Service", () => {
  it("formatNetworkZombieType formats all types accurately", () => {
    expect(formatNetworkZombieType("VPN_GATEWAY")).toBe("Virtual Network Gateway (VPN)");
    expect(formatNetworkZombieType("EXPRESSROUTE_GATEWAY")).toBe("ExpressRoute Gateway");
    expect(formatNetworkZombieType("PUBLIC_IP_UNATTACHED")).toBe("IP Pública Sin Asociar");
    expect(formatNetworkZombieType("PRIVATE_ENDPOINT_ORPHAN")).toBe("Private Endpoint Desconectado");
    expect(formatNetworkZombieType("NAT_GATEWAY_EMPTY")).toBe("NAT Gateway Vacío");
    expect(formatNetworkZombieType("APP_GATEWAY_EMPTY")).toBe("Application Gateway / Firewall Vacío");
    expect(formatNetworkZombieType("PLATFORM_WATCHER")).toBe("Network Watcher (Platform)");
  });

  it("computeNetworkingZombiesSummary calculates monthly & annual waste correctly excluding exemptions and platform watchers", () => {
    const mockZombies: NetworkZombieResourceItem[] = [
      {
        id: "z1",
        name: "gw-1",
        resourceType: "microsoft.network/virtualnetworkgateways",
        zombieType: "VPN_GATEWAY",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        idleDays: 30,
        detectionReason: "No active connections",
        monthlyCostUSD: 140.0,
        isExempted: false,
      },
      {
        id: "z2",
        name: "pip-1",
        resourceType: "microsoft.network/publicipaddresses",
        zombieType: "PUBLIC_IP_UNATTACHED",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        idleDays: 30,
        detectionReason: "Unattached IP",
        monthlyCostUSD: 3.65,
        isExempted: false,
      },
      {
        id: "z3",
        name: "nw-1",
        resourceType: "microsoft.network/networkwatchers",
        zombieType: "PLATFORM_WATCHER",
        location: "eastus",
        resourceGroup: "NetworkWatcherRG",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        idleDays: 0,
        detectionReason: "Platform Watcher",
        monthlyCostUSD: 0.0,
        isExempted: true,
      },
      {
        id: "z4",
        name: "nat-1",
        resourceType: "microsoft.network/natgateways",
        zombieType: "NAT_GATEWAY_EMPTY",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        idleDays: 30,
        detectionReason: "Empty NAT",
        monthlyCostUSD: 32.85,
        isExempted: true, // exempted -> not counted in waste
      },
    ];

    const mockPEs: PrivateEndpointDetailItem[] = [
      {
        id: "pe1",
        name: "pe-1",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        connectionStatus: "Connected",
        monthlyCostUSD: 7.2,
      },
      {
        id: "pe2",
        name: "pe-2",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        connectionStatus: "Rejected",
        monthlyCostUSD: 7.2,
      },
    ];

    const summary = computeNetworkingZombiesSummary(mockZombies, mockPEs);

    expect(summary.totalScannedCount).toBe(4);
    expect(summary.totalWasteMonthlyUSD).toBe(143.65); // 140 + 3.65
    expect(summary.totalWasteAnnualUSD).toBe(1723.8); // 143.65 * 12
    expect(summary.activePrivateEndpointsCount).toBe(1);
    expect(summary.privateEndpointsMonthlyCostUSD).toBe(14.4); // 2 * 7.2
  });

  it("getMockNetworkingZombiesPayload returns structured mock data for demo tenants", () => {
    const payload = getMockNetworkingZombiesPayload("demo_tenant");
    expect(payload.source).toBe("mock");
    expect(payload.metrics.zombies.length).toBeGreaterThan(0);
    expect(payload.metrics.privateEndpoints.length).toBeGreaterThan(0);
    expect(payload.metrics.totalWasteMonthlyUSD).toBeGreaterThan(0);
  });

  it("assembleLiveNetworkingZombies correctly parses ARG items, maps subscription names, and applies exemptions", () => {
    const exemptions = new Map<string, { reason: string; exemptedAt: string; expiresAt?: string | null }>([
      ["/subscriptions/sub-1/resourcegroups/rg-1/providers/microsoft.network/publicipaddresses/pip-exempt", {
        reason: "Reserved IP for VIP customer",
        exemptedAt: "2026-08-01",
      }],
    ]);

    const subNameMap = new Map<string, string>([
      ["sub-1", "CSCS-Production-LandingZone"],
    ]);

    const payload = assembleLiveNetworkingZombies({
      rawGateways: [
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/virtualNetworkGateways/vgw-idle",
          name: "vgw-idle",
          location: "eastus",
          resourceGroup: "rg-1",
          subscriptionId: "sub-1",
          gatewayType: "Vpn",
        },
      ],
      rawPublicIps: [
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/publicIPAddresses/pip-exempt",
          name: "pip-exempt",
          location: "eastus",
          resourceGroup: "rg-1",
          subscriptionId: "sub-1",
        },
      ],
      rawPrivateEndpoints: [
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/privateEndpoints/pe-broken",
          name: "pe-broken",
          location: "eastus",
          resourceGroup: "rg-1",
          subscriptionId: "sub-1",
          connectionState: "Disconnected",
          isOrphan: true,
        },
      ],
      rawNatGateways: [],
      rawAppGateways: [],
      rawNetworkWatchers: [],
      exemptions,
      subNameMap,
    });

    expect(payload.source).toBe("live");
    expect(payload.metrics.zombies.length).toBe(3); // 1 vgw, 1 pip, 1 pe orphan
    const exemptPip = payload.metrics.zombies.find((z) => z.name === "pip-exempt");
    expect(exemptPip?.isExempted).toBe(true);
    expect(exemptPip?.exemptionReason).toBe("Reserved IP for VIP customer");
    expect(exemptPip?.subscriptionName).toBe("CSCS-Production-LandingZone");

    const vgw = payload.metrics.zombies.find((z) => z.name === "vgw-idle");
    expect(vgw?.subscriptionName).toBe("CSCS-Production-LandingZone");
    expect(vgw?.monthlyCostUSD).toBe(140.0);
  });
});
