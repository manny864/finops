"use client";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "./TenantProvider";

interface BulkTagModalProps {
  isOpen: boolean;
  resourceIds: string[];
  resourceNames: string[];
  onClose: () => void;
  onSuccess?: () => void;
  t: (key: string, opts?: any) => string; // Translation function
}

export default function BulkTagModal({
  isOpen,
  resourceIds,
  resourceNames,
  onClose,
  onSuccess,
  t,
}: BulkTagModalProps) {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const [tagValues, setTagValues] = useState<Record<string, string>>({
    Environment: "",
    CostCenter: "",
    Owner: "",
  });
  const [isApplying, setIsApplying] = useState(false);
  const [results, setResults] = useState<
    Array<{ resourceId: string; success: boolean; error?: string }> | null
  >(null);

  const handleTagChange = (key: string, value: string) => {
    setTagValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = async () => {
    if (resourceIds.length === 0) {
      toast.error(t("noResourcesSelected", { defaultMessage: "No resources selected" }));
      return;
    }

    const tagsToApply = Object.fromEntries(
      Object.entries(tagValues).filter(([, v]) => v.trim())
    );

    if (Object.keys(tagsToApply).length === 0) {
      toast.error(t("noTagsEntered", { defaultMessage: "Enter at least one tag" }));
      return;
    }

    setIsApplying(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch("/api/tags/apply-bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          resourceIds,
          tags: tagsToApply,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(
          json.error || t("applyError", { defaultMessage: "Error applying tags" })
        );
        return;
      }

      // Show summary
      setResults(json.results || []);
      if (json.summary.failed === 0) {
        toast.success(
          t("bulkApplySuccess", {
            defaultMessage: `${json.summary.succeeded} resources tagged successfully`,
            count: json.summary.succeeded,
          })
        );
      } else {
        toast.warning(
          t("bulkApplyPartial", {
            defaultMessage: `${json.summary.succeeded} succeeded, ${json.summary.failed} failed`,
            succeeded: json.summary.succeeded,
            failed: json.summary.failed,
          })
        );
      }

      // Reset and close after a brief delay
      setTimeout(() => {
        setTagValues({ Environment: "", CostCenter: "", Owner: "" });
        setResults(null);
        onSuccess?.();
        onClose();
      }, 2000);
    } catch (e: any) {
      toast.error(
        t("networkError", {
          defaultMessage: "Network error",
          error: e.message,
        })
      );
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen || typeof document === "undefined") return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full mx-4 border border-gray-100 dark:border-slate-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/50">
          <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white">
            {t("bulkTagTitle", { defaultMessage: "Apply Tags to Selected Resources" })}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Resource Count */}
          <div className="bg-[#E6F2FB] dark:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-2xl p-3.5 text-sm">
            <div className="font-bold text-[#0054A6] dark:text-cyan-400">
              {t("selectedResources", {
                defaultMessage: "Selected Resources",
                count: resourceIds.length,
              })}
              : {resourceIds.length}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-h-20 overflow-y-auto font-mono">
              {resourceNames.slice(0, 5).join(", ")}
              {resourceNames.length > 5 && ` +${resourceNames.length - 5}`}
            </div>
          </div>

          {/* Warning */}
          {resourceIds.length > 10 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-3 flex gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800 dark:text-amber-300">
                {t("bulkTagWarning", {
                  defaultMessage:
                    "Large bulk operations may take several minutes. Do not close this window.",
                })}
              </span>
            </div>
          )}

          {/* Tag Inputs */}
          <div className="space-y-3">
            {["Environment", "CostCenter", "Owner"].map((tag) => (
              <div key={tag}>
                <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-300 mb-1">
                  {tag}
                  <span className="text-gray-400 ml-1 text-[10px] font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder={`e.g., Prod / 12345 / john@example.com`}
                  value={tagValues[tag] || ""}
                  onChange={(e) => handleTagChange(tag, e.target.value)}
                  disabled={isApplying}
                  className="w-full px-3.5 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#0054A6]/20 focus:border-[#0054A6] disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          {/* Results */}
          {results && results.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                {t("results", { defaultMessage: "Results" })}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.resourceId}
                    className="flex items-start gap-2 text-xs p-2 bg-gray-50 dark:bg-slate-800/50 rounded-xl"
                  >
                    {r.success ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                        <span className="text-emerald-700 dark:text-emerald-300 font-mono truncate">
                          {r.resourceId.split("/").pop()}
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-red-700 dark:text-red-300">{r.error}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
          <button
            onClick={onClose}
            disabled={isApplying}
            className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {t("cancel", { defaultMessage: "Cancel" })}
          </button>
          <button
            onClick={handleApply}
            disabled={isApplying || resourceIds.length === 0}
            className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-900 text-[#0054A6] dark:text-cyan-400 border border-[#0054A6] dark:border-cyan-500 hover:bg-blue-50/50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
          >
            {isApplying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("applying", { defaultMessage: "Applying..." })}
              </>
            ) : (
              t("apply", { defaultMessage: "Apply Tags" })
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
