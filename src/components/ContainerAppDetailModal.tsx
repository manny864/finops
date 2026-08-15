"use client";

import React, { useEffect, useState } from "react";
import { X, Copy, ExternalLink } from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "@/components/TenantProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";

interface ContainerAppDetail {
  name: string;
  resourceGroup: string;
  region: string;
  state: string;
  provisioningState: string;
  image?: string;
  ingress?: {
    fqdn?: string;
    external: boolean;
    targetPort: number;
    transport: string;
  };
  replicas?: {
    minReplicas: number;
    maxReplicas: number;
    currentReplicas: number;
  };
  scaling?: {
    minReplicas: number;
    maxReplicas: number;
    rules?: Array<{
      name: string;
      ruleType: string;
      metadata?: Record<string, string>;
    }>;
  };
  managedIdentity?: {
    enabled: boolean;
    principalId?: string;
  };
  revisions?: Array<{
    name: string;
    active: boolean;
    creationTime: string;
    image: string;
    trafficWeight?: number;
  }>;
  environment?: string;
  cpu?: number;
  memory?: number;
  runtimeMetrics?: {
    requests?: number;
    cpuUsagePct?: number;
    memoryUsageBytes?: number;
  };
}

interface ContainerAppDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptionId: string;
  resourceGroup: string;
  appName: string;
}

export default function ContainerAppDetailModal({
  isOpen,
  onClose,
  subscriptionId,
  resourceGroup,
  appName,
}: ContainerAppDetailModalProps) {
  const [detail, setDetail] = useState<ContainerAppDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();

  useEffect(() => {
    if (!isOpen) return;

    const fetchDetail = async () => {
      if (!selectedTenant) return;
      setLoading(true);
      setError(null);

      try {
        const tenantId = selectedTenant.id;
        let token: string | null = null;
        if (!isMockTenant(tenantId)) {
          if (!accounts[0]) throw new Error("No session");
          token = await getFreshIdToken(instance, accounts[0]);
        }

        const params = new URLSearchParams({
          tenantId,
          subscriptionId,
          resourceGroup,
          appName,
        });

        const response = await fetch(`/api/intelligence/container-apps/details?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || `HTTP ${response.status}`);
        }

        setDetail(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error loading details");
      } finally {
        setLoading(false);
      }
    };

    void fetchDetail();
  }, [isOpen, selectedTenant, subscriptionId, resourceGroup, appName, accounts, instance]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-xl bg-white shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{appName}</h2>
            <p className="text-xs text-slate-500">{resourceGroup}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-sm text-slate-600">Loading details...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* State & Configuration */}
              <section>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">State & Configuration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">State</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{detail.state}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Provisioning State</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {detail.provisioningState}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Region</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{detail.region}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Environment</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{detail.environment || "-"}</p>
                  </div>
                </div>
              </section>

              {/* Compute Resources */}
              {(detail.cpu || detail.memory) && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Compute Resources</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {detail.cpu !== undefined && (
                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">CPU</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{detail.cpu} cores</p>
                      </div>
                    )}
                    {detail.memory !== undefined && (
                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Memory</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{detail.memory} GiB</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {detail.runtimeMetrics && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Runtime Metrics (24h)</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Requests</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail.runtimeMetrics.requests?.toLocaleString() ?? "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">CPU Avg</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail.runtimeMetrics.cpuUsagePct !== undefined ? `${detail.runtimeMetrics.cpuUsagePct}%` : "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Memory Avg</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail.runtimeMetrics.memoryUsageBytes !== undefined
                          ? `${(detail.runtimeMetrics.memoryUsageBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
                          : "-"}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* Scaling Configuration */}
              {detail.scaling && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Scaling Configuration</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Min Replicas</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{detail.scaling.minReplicas}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Max Replicas</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{detail.scaling.maxReplicas}</p>
                    </div>
                  </div>
                  {detail.scaling.rules && detail.scaling.rules.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-slate-700">Scaling Rules:</p>
                      <ul className="mt-2 space-y-1">
                        {detail.scaling.rules.map((rule) => (
                          <li key={rule.name} className="text-xs text-slate-600">
                            • {rule.name} ({rule.ruleType})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {/* Image Information */}
              {detail.image && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Image Information</h3>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-500">Image</p>
                        <p className="mt-1 truncate text-sm font-medium text-slate-900">{detail.image}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(detail.image || "");
                        }}
                        className="flex-shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"
                        title="Copy image"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Ingress Configuration */}
              {detail.ingress && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Ingress Configuration</h3>
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">External</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail.ingress.external ? "Yes" : "No"}
                      </p>
                    </div>
                    {detail.ingress.fqdn && (
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-500">FQDN</p>
                            <p className="mt-1 truncate text-sm font-medium text-slate-900">
                              {detail.ingress.fqdn}
                            </p>
                          </div>
                          <a
                            href={`${detail.ingress.transport}://${detail.ingress.fqdn}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"
                            title="Open in browser"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Target Port</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.ingress.targetPort}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Transport</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.ingress.transport}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Managed Identity */}
              {detail.managedIdentity && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Managed Identity</h3>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Enabled</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {detail.managedIdentity.enabled ? "Yes" : "No"}
                    </p>
                    {detail.managedIdentity.principalId && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="text-xs text-slate-500">Principal ID</p>
                        <p className="mt-1 truncate font-mono text-xs text-slate-600">
                          {detail.managedIdentity.principalId}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Revisions */}
              {detail.revisions && detail.revisions.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Revisions</h3>
                  <div className="space-y-2">
                    {detail.revisions.map((rev) => (
                      <div key={rev.name} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              rev.active ? "bg-emerald-500" : "bg-slate-300"
                            }`}
                          ></span>
                          <span className="text-sm font-medium text-slate-900">{rev.name}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Created: {rev.creationTime ? new Date(rev.creationTime).toLocaleString() : "-"}
                        </p>
                        {typeof rev.trafficWeight === "number" && (
                          <p className="mt-1 text-xs text-slate-600">Traffic: {rev.trafficWeight}%</p>
                        )}
                        <p className="mt-1 truncate text-xs text-slate-500">{rev.image}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
