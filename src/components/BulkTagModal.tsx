"use client";
import React, { useState } from "react";
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t("bulkTagTitle", { defaultMessage: "Apply Tags to Selected Resources" })}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Resource Count */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
            <div className="font-semibold text-blue-900 dark:text-blue-100">
              {t("selectedResources", {
                defaultMessage: "Selected Resources",
                count: resourceIds.length,
              })}
              : {resourceIds.length}
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-1 max-h-20 overflow-y-auto">
              {resourceNames.slice(0, 5).join(", ")}
              {resourceNames.length > 5 && ` +${resourceNames.length - 5}`}
            </div>
          </div>

          {/* Warning */}
          {resourceIds.length > 10 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800 dark:text-amber-200">
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
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {tag}
                  <span className="text-gray-400 ml-1 text-[10px]">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder={`e.g., Prod / 12345 / john@example.com`}
                  value={tagValues[tag] || ""}
                  onChange={(e) => handleTagChange(tag, e.target.value)}
                  disabled={isApplying}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          {/* Results */}
          {results && results.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t("results", { defaultMessage: "Results" })}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.resourceId}
                    className="flex items-start gap-2 text-xs p-2 bg-gray-50 dark:bg-slate-800/50 rounded"
                  >
                    {r.success ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-green-700 dark:text-green-300">
                          {t("tagApplied", { defaultMessage: "Tag applied" })}
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
        <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
          <button
            onClick={onClose}
            disabled={isApplying}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {t("cancel", { defaultMessage: "Cancel" })}
          </button>
          <button
            onClick={handleApply}
            disabled={isApplying || resourceIds.length === 0}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
}
