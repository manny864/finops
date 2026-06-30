import { Metadata } from "next";

export const metadata: Metadata = {
  title: "System Status - CSCloudSolutions FinOps",
  description: "Check the status of the CSCloudSolutions FinOps platform",
};

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

function StatusBadge({ status }: { status: string }) {
  const baseClass = "inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm";
  if (status === "operational") {
    return <span className={`${baseClass} bg-green-100 text-green-800`}>🟢 Operational</span>;
  }
  if (status === "degraded") {
    return <span className={`${baseClass} bg-yellow-100 text-yellow-800`}>🟡 Degraded</span>;
  }
  return <span className={`${baseClass} bg-red-100 text-red-800`}>🔴 Down</span>;
}

function ComponentCard({ component }: { component: Component }) {
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
        <p className="text-sm text-gray-600">Latency: {component.latency_ms}ms</p>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    minor: "bg-blue-100 text-blue-800",
    major: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[severity as keyof typeof colors] || colors.minor}`}>{severity}</span>;
}

function StatusBadgeSmall({ status }: { status: string }) {
  const colors = {
    investigating: "bg-gray-100 text-gray-800",
    identified: "bg-blue-100 text-blue-800",
    monitoring: "bg-yellow-100 text-yellow-800",
    resolved: "bg-green-100 text-green-800",
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[status as keyof typeof colors] || colors.investigating}`}>
      {status}
    </span>
  );
}

export default async function StatusPage() {
  const statusData = await getStatusData();
  const incidents = await getIncidents();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <meta httpEquiv="refresh" content="60" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">System Status</h1>
          <p className="text-gray-600">CSCloudSolutions FinOps Platform</p>
        </div>

        {/* Overall Status Banner */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8 border-l-4 border-gray-300">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {statusData.status === "operational" && "🟢 All Systems Operational"}
                {statusData.status === "degraded" && "🟡 Partial Degradation"}
                {statusData.status === "down" && "🔴 Major Outage"}
              </h2>
              <p className="text-gray-600 text-sm">Last updated: {new Date(statusData.timestamp).toLocaleString()}</p>
            </div>
            <div>
              <StatusBadge status={statusData.status} />
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">Uptime (30 days)</p>
            <p className="text-3xl font-bold text-gray-900">{statusData.uptime_30d_pct.toFixed(2)}%</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">Incidents (30 days)</p>
            <p className="text-3xl font-bold text-gray-900">{statusData.incidents_last_30d}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-500">
            <p className="text-gray-600 text-sm font-semibold mb-1">Version</p>
            <p className="text-lg font-mono text-gray-900 truncate">{statusData.version}</p>
          </div>
        </div>

        {/* Components Grid */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Components</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {statusData.components.map((component) => (
              <ComponentCard key={component.name} component={component} />
            ))}
          </div>
        </div>

        {/* Recent Incidents */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Recent Incidents</h3>
          {incidents.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-600">No incidents in the last 30 days</div>
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
                      <SeverityBadge severity={incident.severity} />
                      <StatusBadgeSmall status={incident.status} />
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    <p>
                      Started: {new Date(incident.startedAt).toLocaleString()}
                      {incident.resolvedAt && ` • Resolved: ${new Date(incident.resolvedAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subscribe Section */}
        <div className="bg-blue-50 rounded-lg shadow p-8 border border-blue-200">
          <h3 className="text-lg font-bold text-gray-900 mb-2">Subscribe to Updates</h3>
          <p className="text-gray-600 mb-4">Get notified when our status changes</p>
          <a href="mailto:support@cscloudsolutions.com.ar?subject=Status Updates" className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
            Subscribe via Email
          </a>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>CSCloudSolutions FinOps Platform • Last snapshot at {new Date(statusData.timestamp).toLocaleTimeString()}</p>
        </div>
      </div>
    </div>
  );
}
