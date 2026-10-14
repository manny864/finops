"use client";

import { useTranslations, useLocale } from "next-intl";
import { useMsal } from "@azure/msal-react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { errorMessage } from "@/lib/apiErrors";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/demoTenant";
import type { NetworkTrafficPilotResult } from "@/services/networkTrafficPilot.service";

type PilotResponse = NetworkTrafficPilotResult & { mock?: boolean };

async function fetchTrafficPilot(
  url: string,
  instance: ReturnType<typeof useMsal>["instance"],
  accounts: ReturnType<typeof useMsal>["accounts"],
  isMock: boolean
): Promise<PilotResponse> {
  const headers: Record<string, string> = {};
  if (!isMock) {
    const account = accounts[0];
    if (!account) throw new Error("No hay una sesión de Microsoft activa.");
    const token = await getFreshIdToken(instance, account, ["User.Read"]);
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as PilotResponse;
}

function formatGb(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / 1_000_000_000)} GB`;
}

export default function NetworkTrafficPilotBoard() {
  const t = useTranslations("NetworkEgress");
  const locale = useLocale();
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const tenantId = selectedTenant?.id || "";
  const mock = isMockTenant(tenantId);
  const url = tenantId
    ? `/api/intelligence/network/traffic-pilot?tenantId=${encodeURIComponent(tenantId)}&dias=7`
    : null;

  const { data, error, isLoading } = useSWR<PilotResponse>(
    url,
    (requestUrl) => fetchTrafficPilot(requestUrl, instance, accounts, mock),
    { revalidateOnFocus: false }
  );

  const statusKey = data?.status === "ready" ? "pilotReady"
    : data?.status === "partial" ? "pilotPartial"
    : data?.status === "not_configured" ? "pilotNotConfigured"
    : data?.status === "no_data" ? "pilotNoData"
    : data?.status === "unavailable" ? "pilotUnavailable"
    : null;

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("pilotTitle")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("pilotSubtitle")}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">{t("pilotLoading")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t("pilotLoadError")}: {errorMessage(error)}</p>
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{t("pilotCoverage", { active: data.activeFlowLogs, configured: data.configuredFlowLogs, workspaces: data.queriedWorkspaceCount, workspaceTotal: data.workspaceCount })}</span>
            <span>{t("pilotObservedVolume", { volume: formatGb(data.totalObservedBytes, locale) })}</span>
            {data.mock ? <span className="font-medium text-amber-700 dark:text-amber-400">{t("pilotDemoData")}</span> : null}
          </div>

          {statusKey ? (
            <p className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
              {t(statusKey)}
            </p>
          ) : null}

          {data.edges.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("pilotSource")}</th>
                    <th className="px-3 py-2 font-medium">{t("pilotDestination")}</th>
                    <th className="px-3 py-2 font-medium">{t("pilotFlowType")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("pilotVolume")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.edges.map((edge, index) => (
                    <tr key={`${edge.source}-${edge.destination}-${edge.flowType}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{edge.source}</td>
                      <td className="px-3 py-2">{edge.destination}</td>
                      <td className="px-3 py-2 text-slate-500">{edge.flowType || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGb(edge.bytes, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {data.issues.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
              {data.issues.map((issue) => (
                <li key={`${issue.workspace}-${issue.reason}`}>
                  {issue.workspace}: {t(`pilotIssue_${issue.reason}`)}
                </li>
              ))}
            </ul>
          ) : null}

          {data.truncated ? <p className="text-xs text-amber-700 dark:text-amber-400">{t("pilotTruncated")}</p> : null}
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("pilotDisclaimer")}</p>
        </>
      ) : null}
    </section>
  );
}
