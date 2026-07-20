import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Status");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

interface Component {
  name: string;
  status: "operational" | "degraded" | "down";
  latency_ms?: number;
}

interface StatusData {
  status: "operational" | "degraded" | "down";
  timestamp: string;
  components: Component[];
  uptime_30d_pct: number;
  incidents_last_30d: number;
  version: string;
}

interface Incident {
  id: number;
  title: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  startedAt: string;
  resolvedAt: string | null;
  description?: string;
}

async function getStatusData(): Promise<StatusData> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/status`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch status");
    return response.json();
  } catch (e) {
    console.error("Status fetch error:", e);
    return {
      status: "down",
      timestamp: new Date().toISOString(),
      components: [],
      uptime_30d_pct: 0,
      incidents_last_30d: 0,
      version: "unknown",
    };
  }
}

async function getIncidents(): Promise<Incident[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/status/incidents`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch incidents");
    const data = await response.json();
    return data.incidents || [];
  } catch (e) {
    console.error("Incidents fetch error:", e);
    return [];
  }
}

type StatusT = Awaited<ReturnType<typeof getTranslations>>;

function StatusBadge({ status, t }: { status: string; t: StatusT }) {
  const baseClass = "inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm";
  if (status === "operational") {
    return <span className={`${baseClass} bg-green-100 text-green-800`}>{t("badgeOperational")}</span>;
  }
  if (status === "degraded") {
    return <span className={`${baseClass} bg-yellow-100 text-yellow-800`}>{t("badgeDegraded")}</span>;
  }
  return <span className={`${baseClass} bg-red-100 text-red-800`}>{t("badgeDown")}</span>;
}

function ComponentCard({ component, t }: { component: Component; t: StatusT }) {
  const statusColor = {
    operational: "border-green-200 bg-green-50",
    degraded: "border-yellow-200 bg-yellow-50",
    down: "border-red-200 bg-red-50",
  };

  const statusIndicator = {
    operational: "🟢",
    degraded: "🟡",
    down: "🔴",
  };

  return (
    <div className={`border p-4 rounded-lg ${statusColor[component.status]}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{component.name}</h3>
        <span className="text-lg">{statusIndicator[component.status]}</span>
      </div>
      {component.latency_ms !== undefined && component.latency_ms > 0 && (
        <p className="text-sm text-gray-600">{t("latencyLabel", { ms: component.latency_ms })}</p>
      )}
    </div>
  );
}

function SeverityBadge({ severity, t }: { severity: string; t: StatusT }) {
  const colors = {
    minor: "bg-blue-100 text-blue-800",
    major: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };
  const labels = {
    minor: t("severityMinor"),
    major: t("severityMajor"),
    critical: t("severityCritical"),
  };
  const key = (severity as keyof typeof colors) in colors ? (severity as keyof typeof colors) : "minor";
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[key]}`}>{labels[key]}</span>;
}

function StatusBadgeSmall({ status, t }: { status: string; t: StatusT }) {
  const colors = {
    investigating: "bg-gray-100 text-gray-800",
    identified: "bg-blue-100 text-blue-800",
    monitoring: "bg-yellow-100 text-yellow-800",
    resolved: "bg-green-100 text-green-800",
  };
  const labels = {
    investigating: t("incidentStatusInvestigating"),
    identified: t("incidentStatusIdentified"),
    monitoring: t("incidentStatusMonitoring"),
    resolved: t("incidentStatusResolved"),
  };
  const key = (status as keyof typeof colors) in colors ? (status as keyof typeof colors) : "investigating";
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[key]}`}>
      {labels[key]}
    </span>
  );
}

export default async function StatusPage() {
  const t = await getTranslations("Status");
  const statusData = await getStatusData();
  const incidents = await getIncidents();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <meta httpEquiv="refresh" content="60" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{t("pageTitle")}</h1>
          <p className="text-gray-600">{t("pageSubtitle")}</p>
        </div>

        {/* Overall Status Banner */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8 border-l-4 border-gray-300">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {statusData.status === "operational" && t("bannerOperational")}
                {statusData.status === "degraded" && t("bannerDegraded")}
                {statusData.status === "down" && t("bannerDown")}
              </h2>
              <p className="text-gray-600 text-sm">{t("lastUpdated", { date: new Date(statusData.timestamp).toLocaleString() })}</p>
            </div>
            <div>
              <StatusBadge status={statusData.status} t={t} />
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">{t("metricUptime")}</p>
            <p className="text-3xl font-bold text-gray-900">{statusData.uptime_30d_pct.toFixed(2)}%</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">{t("metricIncidents")}</p>
            <p className="text-3xl font-bold text-gray-900">{statusData.incidents_last_30d}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">{t("metricVersion")}</p>
            <p className="text-lg font-mono text-gray-900 truncate">{statusData.version}</p>
          </div>
        </div>

        {/* Components Grid */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">{t("componentsTitle")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {statusData.components.map((component) => (
              <ComponentCard key={component.name} component={component} t={t} />
            ))}
          </div>
        </div>

        {/* Recent Incidents */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">{t("incidentsTitle")}</h3>
          {incidents.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-600">{t("noIncidents")}</div>
          ) : (
            <div className="space-y-4">
              {incidents.map((incident) => (
                <div key={incident.id} className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-300">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">{incident.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{incident.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <SeverityBadge severity={incident.severity} t={t} />
                      <StatusBadgeSmall status={incident.status} t={t} />
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    <p>
                      {t("startedLabel", { date: new Date(incident.startedAt).toLocaleString() })}
                      {incident.resolvedAt && t("resolvedLabel", { date: new Date(incident.resolvedAt).toLocaleString() })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subscribe Section */}
        <div className="bg-blue-50 rounded-lg shadow p-8 border border-blue-200">
          <h3 className="text-lg font-bold text-gray-900 mb-2">{t("subscribeTitle")}</h3>
          <p className="text-gray-600 mb-4">{t("subscribeBody")}</p>
          <a href="mailto:soporte@cscloudsolutions.com.ar?subject=Status Updates" className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
            {t("subscribeButton")}
          </a>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>{t("footer", { time: new Date(statusData.timestamp).toLocaleTimeString() })}</p>
        </div>
      </div>
    </div>
  );
}
