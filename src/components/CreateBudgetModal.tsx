"use client";

import React, { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import KillSwitchConfig from "@/components/budgets/KillSwitchConfig";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { useProviderTranslations } from "@/lib/useProviderTranslations";

interface CreateBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  subscriptionId: string;
  tenantId: string;
  initialMode?: "create" | "edit";
  nativeBudgets?: Array<{ subscriptionId: string; budgetName: string; amount: number }>;
}

interface BudgetData {
  id: number;
  costCenter: string;
  monthlyLimit: number;
  alertThreshold: number;
}

export default function CreateBudgetModal({
  isOpen,
  onClose,
  onSuccess,
  subscriptionId,
  tenantId,
  initialMode = "create",
  nativeBudgets = [],
}: CreateBudgetModalProps) {
  const t = useProviderTranslations("Budgets");
  const { instance, accounts } = useMsal();
  const [budgetName, setBudgetName] = useState("");
  const [amount, setAmount] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("80");
  const [timeGrain, setTimeGrain] = useState("BillingMonth");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existingBudgets, setExistingBudgets] = useState<BudgetData[]>([]);
  const [selectedNativeBudgetKey, setSelectedNativeBudgetKey] = useState("");
  const [mode, setMode] = useState<"create" | "edit">("create");

  const editOptions = nativeBudgets.length > 0
    ? nativeBudgets
    : existingBudgets.map((b) => ({
        subscriptionId,
        budgetName: b.costCenter,
        amount: b.monthlyLimit,
      }));

  useEffect(() => {
    if (!isOpen || isMockTenant(tenantId)) return;
    (async () => {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(`/api/budgets?tenantId=${tenantId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        setExistingBudgets(json.budgets || []);
      } catch (e) {
        console.error("Failed to load budgets:", e);
      }
    })();
  }, [isOpen, tenantId, instance, accounts]);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (mode !== "edit" || !selectedNativeBudgetKey) return;
    const selected = editOptions.find(
      (b) => `${b.subscriptionId}::${b.budgetName}` === selectedNativeBudgetKey
    );
    if (!selected) return;

    setBudgetName(selected.budgetName);
    setAmount(String(selected.amount));
    const localMatch = existingBudgets.find((b) => b.costCenter === selected.budgetName);
    setAlertThreshold(String(localMatch?.alertThreshold ?? 80));
  }, [mode, selectedNativeBudgetKey, editOptions, existingBudgets]);

  useEffect(() => {
    if (mode === "edit" && !selectedNativeBudgetKey && editOptions.length > 0) {
      setSelectedNativeBudgetKey(`${editOptions[0].subscriptionId}::${editOptions[0].budgetName}`);
    }
  }, [mode, selectedNativeBudgetKey, editOptions]);

  if (!isOpen) return null;

  const resetForm = () => {
    setBudgetName("");
    setAmount("");
    setContactEmail("");
    setAlertThreshold("80");
    setTimeGrain("BillingMonth");
    setSelectedNativeBudgetKey("");
    setMode("create");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetName || !amount || (mode === "create" && !contactEmail)) {
      toast.error(t("createModalMissingFields"));
      return;
    }

    setLoading(true);
    try {
      if (isMockTenant(tenantId)) {
        toast.success(mode === "create" ? t("createModalSuccess") : "Budget updated");
        onSuccess();
        onClose();
        resetForm();
        return;
      }

      const idToken = await getFreshIdToken(instance, accounts[0]);

      if (mode === "create") {
        const res = await fetch("/api/budgets/create", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscriptionId,
            budgetName,
            amount: Number(amount),
            contactEmail,
            alertThreshold: Number(alertThreshold),
            tenantId,
            timeGrain,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          toast.error(json.details || json.error || t("createModalFailed"));
          return;
        }

        await fetch("/api/budgets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            costCenter: budgetName,
            monthlyLimit: Number(amount),
            alertThreshold: Number(alertThreshold),
          }),
        });

        toast.success(t("createModalSuccess"));
        onSuccess();
        onClose();
        resetForm();
        return;
      }

      const editContactEmail = contactEmail || accounts[0]?.username;
      if (!editContactEmail) {
        toast.error("No contact email available for update");
        return;
      }

      const selectedNativeBudget = editOptions.find(
        (b) => `${b.subscriptionId}::${b.budgetName}` === selectedNativeBudgetKey
      );
      const targetSubscriptionId = selectedNativeBudget?.subscriptionId || subscriptionId;
      const targetBudgetName = selectedNativeBudget?.budgetName || budgetName;

      const azureRes = await fetch("/api/budgets/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriptionId: targetSubscriptionId,
          budgetName: targetBudgetName,
          amount: Number(amount),
          contactEmail: editContactEmail,
          alertThreshold: Number(alertThreshold),
          tenantId,
          timeGrain,
        }),
      });

      const azureJson = await azureRes.json();
      if (!azureRes.ok) {
        toast.error(azureJson.details || azureJson.error || "Failed to update budget in Azure");
        return;
      }

      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId,
          costCenter: targetBudgetName,
          monthlyLimit: Number(amount),
          alertThreshold: Number(alertThreshold),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to update budget");
        return;
      }

      toast.success("Budget updated successfully");
      onSuccess();
      onClose();
      resetForm();
    } catch (e: any) {
      console.error("Error:", e);
      toast.error(e.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedNativeBudgetKey) {
      toast.error("Select a budget to delete");
      return;
    }

    setDeleting(true);
    try {
      if (isMockTenant(tenantId)) {
        toast.success("Budget deleted");
        onSuccess();
        onClose();
        resetForm();
        return;
      }

      const idToken = await getFreshIdToken(instance, accounts[0]);
      const selectedNativeBudget = editOptions.find(
        (b) => `${b.subscriptionId}::${b.budgetName}` === selectedNativeBudgetKey
      );
      if (!selectedNativeBudget) {
        toast.error("Selected budget not found");
        return;
      }

      const azureRes = await fetch("/api/budgets/delete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId,
          subscriptionId: selectedNativeBudget.subscriptionId,
          budgetName: selectedNativeBudget.budgetName,
        }),
      });

      const azureJson = await azureRes.json();
      if (!azureRes.ok) {
        toast.error(azureJson.error || "Failed to delete budget in Azure");
        return;
      }

      const localMatch = existingBudgets.find((b) => b.costCenter === selectedNativeBudget.budgetName);
      if (localMatch?.id) {
        const res = await fetch("/api/budgets", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            id: localMatch.id,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error || "Failed to delete budget");
          return;
        }
      }

      toast.success("Budget deleted successfully");
      onSuccess();
      onClose();
      resetForm();
    } catch (e: any) {
      console.error("Error deleting budget:", e);
      toast.error(e.message || "An error occurred");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl animate-in zoom-in-95 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {mode === "create" ? t("createModalTitle") : "Edit Budget"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {editOptions.length > 0 && (
          <div className="flex gap-2 border-b border-gray-200 px-6 py-3 dark:border-slate-800">
            <button
              onClick={() => {
                setMode("create");
                resetForm();
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                mode === "create"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
              }`}
            >
              Create New
            </button>
            <button
              onClick={() => setMode("edit")}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                mode === "edit"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
              }`}
            >
              Edit Existing
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {mode === "edit" && editOptions.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">Select Budget</label>
              <select
                value={selectedNativeBudgetKey}
                onChange={(e) => setSelectedNativeBudgetKey(e.target.value)}
                required
                disabled={loading || deleting}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Choose a budget...</option>
                {editOptions.map((b) => (
                  <option key={`${b.subscriptionId}::${b.budgetName}`} value={`${b.subscriptionId}::${b.budgetName}`}>
                    {b.budgetName} · {b.subscriptionId} (${Number(b.amount || 0).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("createModalNameLabel")}
            </label>
            <input
              type="text"
              value={budgetName}
              onChange={(e) => setBudgetName(e.target.value)}
              placeholder={t("createModalNamePlaceholder")}
              required
              disabled={loading || deleting || mode === "edit"}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("createModalAmountLabel")}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("createModalAmountPlaceholder")}
              required
              disabled={loading || deleting || (mode === "edit" && !selectedNativeBudgetKey)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400"
            />
          </div>

          {mode === "create" && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t("createModalEmailLabel")}
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder={t("createModalEmailPlaceholder")}
                required
                disabled={loading || deleting}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("createModalThresholdLabel")}
            </label>
            <input
              type="number"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              min="0"
              max="100"
              required
              disabled={loading || deleting || (mode === "edit" && !selectedNativeBudgetKey)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {mode === "create" && <KillSwitchConfig subscriptionId={subscriptionId} />}

          <button
            type="submit"
            disabled={loading || deleting || (mode === "edit" && !selectedNativeBudgetKey)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? t("createModalCreate") : "Update Budget"}
          </button>

          {mode === "edit" && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading || deleting || !selectedNativeBudgetKey}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2 font-semibold text-white transition-colors hover:bg-red-700 disabled:bg-gray-400"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete Budget
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
