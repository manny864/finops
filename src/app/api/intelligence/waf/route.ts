/**
 * GET /api/intelligence/waf — WAF (Web Application Firewall) cost and security metrics
 * from Azure Application Gateway + Front Door WAF.
 *
 * RBAC: Tier Business+.
 * Azure roles: Security Reader, Network Contributor, Cost Management Reader.
 * Azure resources:
 *   - microsoft.network/applicationgateways (Application Gateway)
 *   - microsoft.cdn/profiles (Front Door)
 *   - microsoft.network/frontdoorwebapplicationfirewallpolicies (WAF policies)
 * Metrics: ApplicationGatewayFirewallLog, ApplicationGatewayAccessLog, FrontDoorWebApplicationFirewallLog
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

interface WafApplication {
  name: string;
  type: "Application Gateway" | "Front Door";
  region: string;
  resourceGroup: string;
  status: "Enabled" | "Disabled";
  mode: "Detection" | "Prevention";
  owaspVersion: "2.2.9" | "3.1" | "3.2";
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  blockRate: number;
}

interface WafMetrics {
  costPerMonth: number;
  costPerApplication: number;
  costPerMillionRequests: number;
  costPerGbProcessed: number;
  capacityUnitsConsumed: number;
  throughputGb: number;
  falsePositiveRate: number;
}

interface WafSecurityInsight {
  ruleType: string;
  count: number;
  severity: "Low" | "Medium" | "High" | "Critical";
  examples: string[];
}

interface WafSummary {
  totalMonthlyCost: number;
  applicationsProtected: number;
  totalRequests: number;
  totalBlockedRequests: number;
  overallBlockRate: number;
  metrics: WafMetrics;
  applications: WafApplication[];
  topBlockedIps: Array<{ ip: string; country: string; requestsBlocked: number }>;
  topCountries: Array<{ country: string; requestsBlocked: number }>;
  rulesFired: WafSecurityInsight[];
}

const MOCK_SUMMARY: WafSummary = {
  totalMonthlyCost: 850,
  applicationsProtected: 8,
  totalRequests: 45230000,
  totalBlockedRequests: 1245000,
  overallBlockRate: 2.75,
  metrics: {
    costPerMonth: 850,
    costPerApplication: 106.25,
    costPerMillionRequests: 0.0188,
    costPerGbProcessed: 12.5,
    capacityUnitsConsumed: 68,
    throughputGb: 680,
    falsePositiveRate: 0.12,
  },
  applications: [
    {
      name: "api.cscloudsolutions.com.ar",
      type: "Front Door",
      region: "Global",
      resourceGroup: "prod-networking-rg",
      status: "Enabled",
      mode: "Prevention",
      owaspVersion: "3.2",
      totalRequests: 28500000,
      blockedRequests: 850000,
      allowedRequests: 27650000,
      blockRate: 2.98,
    },
    {
      name: "webapp-prod-appgateway",
      type: "Application Gateway",
      region: "East US",
      resourceGroup: "prod-networking-rg",
      status: "Enabled",
      mode: "Prevention",
      owaspVersion: "3.1",
      totalRequests: 12000000,
      blockedRequests: 280000,
      allowedRequests: 11720000,
      blockRate: 2.33,
    },
    {
      name: "admin-app-gateway",
      type: "Application Gateway",
      region: "UK South",
      resourceGroup: "admin-rg",
      status: "Enabled",
      mode: "Detection",
      owaspVersion: "3.2",
      totalRequests: 2800000,
      blockedRequests: 95000,
      allowedRequests: 2705000,
      blockRate: 3.39,
    },
    {
      name: "dashboard-fd-policy",
      type: "Front Door",
      region: "Global",
      resourceGroup: "prod-networking-rg",
      status: "Enabled",
      mode: "Prevention",
      owaspVersion: "3.2",
      totalRequests: 1930000,
      blockedRequests: 20000,
      allowedRequests: 1910000,
      blockRate: 1.04,
    },
  ],
  topBlockedIps: [
    { ip: "192.168.1.45", country: "CN", requestsBlocked: 45230 },
    { ip: "10.0.0.12", country: "RU", requestsBlocked: 38450 },
    { ip: "172.16.0.5", country: "IR", requestsBlocked: 29870 },
    { ip: "203.0.113.99", country: "KP", requestsBlocked: 18920 },
    { ip: "198.51.100.45", country: "SY", requestsBlocked: 15670 },
  ],
  topCountries: [
    { country: "CN", requestsBlocked: 280450 },
    { country: "RU", requestsBlocked: 195230 },
    { country: "IN", requestsBlocked: 128940 },
    { country: "BR", requestsBlocked: 92340 },
    { country: "VN", requestsBlocked: 81450 },
  ],
  rulesFired: [
    {
      ruleType: "SQL Injection",
      count: 45230,
      severity: "High",
      examples: ["'; DROP TABLE users; --", "1' OR '1'='1", "UNION SELECT * FROM admin"],
    },
    {
      ruleType: "Cross-Site Scripting (XSS)",
      count: 38920,
      severity: "High",
      examples: ["<script>alert('XSS')</script>", "javascript:void(0)", "onerror='alert(1)'"],
    },
    {
      ruleType: "Path Traversal",
      count: 28450,
      severity: "Medium",
      examples: ["../../etc/passwd", "..\\..\\windows\\system32", "%2e%2e%2fconfig"],
    },
    {
      ruleType: "Bot Traffic",
      count: 852000,
      severity: "Low",
      examples: ["SQLMap scanner", "Nikto", "Nmap"],
    },
    {
      ruleType: "Command Injection",
      count: 12340,
      severity: "Critical",
      examples: ["; ls -la", "| cat /etc/passwd", "` whoami`"],
    },
  ],
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantTier(request, tenantId, "Business");
    } else {
      await requireTenantAccess(request, tenantId);
    }

    // Mock data para demo
    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        ...MOCK_SUMMARY,
      });
    }

    // Caso real: consultar Azure APIs
    // Por ahora, retorna estructura lista para implementar
    const summary: WafSummary = {
      totalMonthlyCost: 0,
      applicationsProtected: 0,
      totalRequests: 0,
      totalBlockedRequests: 0,
      overallBlockRate: 0,
      metrics: {
        costPerMonth: 0,
        costPerApplication: 0,
        costPerMillionRequests: 0,
        costPerGbProcessed: 0,
        capacityUnitsConsumed: 0,
        throughputGb: 0,
        falsePositiveRate: 0,
      },
      applications: [],
      topBlockedIps: [],
      topCountries: [],
      rulesFired: [],
    };

    return NextResponse.json({
      success: true,
      mock: false,
      ...summary,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("WAF API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
