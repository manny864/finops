"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { CreditCard, AlertCircle, Loader2, Trash2, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";
import { getSubscriptionLimit, getUserLimit } from "@/lib/tierLogic";
import { getSupportConfig } from "@/lib/supportConfig";
import { useMfaChallenge } from "@/hooks/useMfaChallenge";

interface BillingInfo {
  tier: string;
  status: string;
  trialEndsAt: string | null;
  paddleSubscriptionId: string | null;
  marketplaceSource?: string;
  marketplaceSubscriptionId?: string;
  marketplacePlanId?: string;
  isEnterprise?: boolean;
}

interface Invoice {
  id: number;
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  billedAt: string;
}

interface ChangePreview {
  previewAvailable: boolean;
  currencyCode?: string;
  result?: { action: "charge" | "credit" | "none"; amount: string };
  credit?: string;
  charge?: string;
  immediateTotal?: string | null;
  nextBillTotal?: string | null;
  nextBillDate?: string | null;
  recurringTotal?: string | null;
}

// Formatea montos que Paddle devuelve en unidad menor (centavos, string) para display.
// No realiza aritmética de costos: sólo renderiza el valor exacto calculado por Paddle.
function formatMinorAmount(minor: string | null | undefined, currency: string): string {
  if (minor == null || minor === "") return "—";
  const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  const major = Number(minor) / Math.pow(10, digits);
  return fmt.format(major);
}

export default function BillingPage() {
  const t = useTranslations("AdminBilling");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { requestChallenge, mfaModal } = useMfaChallenge();
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingSubscription, setUpdatingSubscription] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedNewTier, setSelectedNewTier] = useState<string | null>(null);
  const [selectedBilling, setSelectedBilling] = useState<"monthly" | "yearly">("monthly");
  const [prorationType, setProrationType] = useState<"prorated_immediately" | "prorated_next_billing_period" | "do_not_bill">(
    "prorated_immediately"
  );
  const [modalStep, setModalStep] = useState<"select" | "confirm">("select");
  const [previewData, setPreviewData] = useState<ChangePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!accounts || accounts.length === 0) return {};
    const token = await getFreshIdToken(instance, accounts[0]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, accounts]);

  const loadBillingInfo = useCallback(async () => {
    if (!selectedTenant?.id || selectedTenant.id === "default") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const headers = await authHeaders();
      // Info del plan (tier/estado/trial/paddle/marketplace) desde /api/billing/plan.
      // NO usar GET /api/billing: ese devuelve la URL de pago de Paddle, no el plan.
      const res = await fetch(`/api/billing/plan?tenantId=${selectedTenant.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setBillingInfo(data);
      } else {
        console.error("Error loading billing info: HTTP", res.status);
      }
    } catch (error: any) {
      console.error("Error loading billing info:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedTenant?.id, authHeaders]);

  const loadInvoices = useCallback(async () => {
    if (!selectedTenant?.id) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/billing/invoices?tenantId=${selectedTenant.id}&limit=20`, { headers });
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      }
    } catch (error: any) {
      console.error("Error loading invoices:", error);
    }
  }, [selectedTenant?.id, authHeaders]);

  useEffect(() => {
    loadBillingInfo();
    loadInvoices();
  }, [loadBillingInfo, loadInvoices]);

  const handleUpdatePaymentMethod = async () => {
    if (!selectedTenant?.id) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/billing?tenantId=${selectedTenant.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, "_blank");
          toast.success(t("toastOpeningPaddlePortal"));
        }
      } else {
        toast.error(t("toastNoPaymentUrl"));
      }
    } catch (error: any) {
      toast.error(t("toastPaymentMethodUpdateError"));
    }
  };

  const resetUpgradeModal = useCallback(() => {
    setShowUpgradeModal(false);
    setModalStep("select");
    setPreviewData(null);
    setSelectedNewTier(null);
  }, []);

  const handlePreviewChange = async () => {
    if (!selectedTenant?.id || !selectedNewTier) return;
    setLoadingPreview(true);
    setPreviewData(null);
    try {
      const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
      const res = await fetch(`/api/billing/subscription/preview?tenantId=${selectedTenant.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          newTier: selectedNewTier,
          billing: selectedBilling,
          prorationBillingMode: prorationType,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPreviewData(data as ChangePreview);
        setModalStep("confirm");
      } else {
        toast.error(data.error || t("toastPreviewError"));
      }
    } catch {
      toast.error(t("toastPreviewCalcError"));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleUpgradeSubscription = async () => {
    if (!selectedTenant?.id || !selectedNewTier) return;
    setUpdatingSubscription(true);
    try {
      // Operación sensible (cambio de plan): solicitar MFA si el usuario tiene 2FA activado.
      const { challengeId, cancelled } = await requestChallenge("change_plan", { tenantId: selectedTenant.id });
      if (cancelled) {
        setUpdatingSubscription(false);
        return;
      }
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
        ...(challengeId ? { "X-MFA-Challenge-Id": challengeId } : {}),
      };
      const res = await fetch(`/api/billing/subscription?tenantId=${selectedTenant.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          newTier: selectedNewTier,
          billing: selectedBilling,
          prorationBillingMode: prorationType,
        }),
      });
      if (res.ok) {
        toast.success(t("toastSubscriptionUpdated"));
        resetUpgradeModal();
        await loadBillingInfo();
      } else {
        const error = await res.json();
        toast.error(error.error || t("toastSubscriptionUpdateError"));
      }
    } catch (error: any) {
      toast.error(t("toastUpgradeProcessError"));
    } finally {
      setUpdatingSubscription(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!selectedTenant?.id) return;
    setUpdatingSubscription(true);
    try {
      // Operación sensible (cancelar suscripción): solicitar MFA si el usuario tiene 2FA activado.
      const { challengeId, cancelled } = await requestChallenge("cancel_subscription", { tenantId: selectedTenant.id });
      if (cancelled) {
        setUpdatingSubscription(false);
        return;
      }
      const headers = {
        ...(await authHeaders()),
        ...(challengeId ? { "X-MFA-Challenge-Id": challengeId } : {}),
      };
      const res = await fetch(`/api/billing/subscription?tenantId=${selectedTenant.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ effective: "immediately" }),
      });
      if (res.ok) {
        toast.success(t("toastSubscriptionCanceled"));
        setShowCancelModal(false);
        await loadBillingInfo();
      } else {
        const error = await res.json();
        toast.error(error.error || t("toastCancelError"));
      }
    } catch (error: any) {
      toast.error(t("toastCancelSubscriptionError"));
    } finally {
      setUpdatingSubscription(false);
    }
  };

  if (!selectedTenant || selectedTenant.id === "default") {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-yellow-500" />
        <p>{t("selectTenantPrompt")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-deep" />
      </div>
    );
  }

  const statusColors = {
    TRIAL: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
    ACTIVE: "text-green-600 bg-green-50 dark:bg-green-900/20",
    PAST_DUE: "text-red-600 bg-red-50 dark:bg-red-900/20",
    CANCELED: "text-gray-600 bg-gray-50 dark:bg-gray-900/20",
  };

  return (
    <div className="space-y-6 p-6">
      {mfaModal}
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-brand-deep" />
        <h1 className="text-3xl font-bold">{t("title")}</h1>
      </div>

      {/* Current Plan Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-xl font-semibold">{t("currentPlan")}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">{t("tier")}</p>
            <p className="text-2xl font-bold">{billingInfo?.tier || t("notAvailable")}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{t("status")}</p>
            <p className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${statusColors[billingInfo?.status as keyof typeof statusColors] || "text-gray-600"}`}>
              {billingInfo?.status ? (t.has(`statusValues.${billingInfo.status}`) ? t(`statusValues.${billingInfo.status}`) : billingInfo.status) : t("notAvailable")}
            </p>
          </div>
          {billingInfo?.status === "TRIAL" && billingInfo.trialEndsAt && (
            <div>
              <p className="text-sm text-gray-500">{t("trialEnds")}</p>
              <p className="font-semibold">{new Date(billingInfo.trialEndsAt).toLocaleDateString()}</p>
            </div>
          )}
        </div>

        {billingInfo?.tier && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-brand-deep" />
            <p>
              {t.rich("planIncludes", {
                tier: billingInfo.tier,
                strong: (chunks) => <strong>{chunks}</strong>,
                subscriptions: (() => { const l = getSubscriptionLimit(billingInfo.tier); return Number.isFinite(l) ? t("subscriptionsLimited", { count: l as number }) : t("subscriptionsUnlimited"); })(),
                users: (() => { const l = getUserLimit(billingInfo.tier); return Number.isFinite(l) ? t("usersLimited", { count: l as number }) : t("usersUnlimited"); })(),
                support: (() => { const q = getSupportConfig(billingInfo.tier).monthlyTicketQuota; return q === null ? t("supportUnlimited") : t("supportLimited", { count: q }); })(),
                slaHours: getSupportConfig(billingInfo.tier).firstResponseSlaHours,
              })}
            </p>
          </div>
        )}

      </div>

      {/* Marketplace Status Card */}
      {billingInfo?.marketplaceSource && billingInfo.marketplaceSource !== 'direct' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-sm dark:border-blue-700 dark:bg-blue-900">
          <div className="flex items-start gap-3">
            <div className="mt-1">
              <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="mb-2 text-lg font-semibold text-blue-900 dark:text-blue-100">
                🔷 {t("marketplaceSubscriptionAzure")}
              </h2>
              <p className="mb-4 text-sm text-blue-800 dark:text-blue-200">
                {t("marketplaceManagedVia", { marketplace: 'Azure' })}
              </p>
              <div className="mb-4 space-y-1 text-sm">
                <p className="text-blue-800 dark:text-blue-200">
                  <span className="font-medium">{t("marketplaceSubscriptionId")}:</span> {billingInfo.marketplaceSubscriptionId}
                </p>
                <p className="text-blue-800 dark:text-blue-200">
                  <span className="font-medium">{t("plan")}:</span> {billingInfo.marketplacePlanId}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="https://portal.azure.com/#view/Microsoft_Azure_SubscriptionManagement/SubscriptionsBlade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("goToAzurePortal")}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Plan Card */}
      {!billingInfo?.marketplaceSource || billingInfo.marketplaceSource === 'direct' ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t("changePlan")}</h2>
            {/* Enterprise usa pricing negociado: no aplica el flujo self-service de
                Paddle (tierToPriceId(Enterprise) = null → daría 502). Mostramos un
                aviso para contactar al equipo comercial. Business es el tope de los
                planes auto-gestionables, por eso tampoco muestra "Actualizar". */}
            {!billingInfo?.isEnterprise && billingInfo?.tier !== "Business" && (
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="rounded-lg bg-brand-deep px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
                disabled={updatingSubscription}
            >
              {updatingSubscription ? <Loader2 className="inline h-4 w-4 animate-spin" /> : t("update")}
            </button>
          )}
        </div>

        {billingInfo?.isEnterprise && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            {t.rich("enterpriseNotice", {
              span: (chunks) => <span className="font-semibold">{chunks}</span>,
              email: (chunks) => (
                <a href="mailto:ventas@cscloudsolutions.com.ar" className="font-semibold underline">
                  {chunks}
                </a>
              ),
            })}
          </div>
        )}

        {showUpgradeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-96 rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
              {modalStep === "select" ? (
                <>
                  <h3 className="mb-4 text-lg font-semibold">{t("selectNewPlan")}</h3>

                  <div className="mb-4 space-y-2">
                    <label className="flex items-center gap-2">
                      <input type="radio" value="Professional" checked={selectedNewTier === "Professional"} onChange={(e) => setSelectedNewTier(e.target.value)} />
                      <span>Professional</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" value="Business" checked={selectedNewTier === "Business"} onChange={(e) => setSelectedNewTier(e.target.value)} />
                      <span>Business</span>
                    </label>
                  </div>

                  <div className="mb-4 space-y-2">
                    <p className="text-sm font-medium">{t("billingFrequency")}:</p>
                    <label className="flex items-center gap-2">
                      <input type="radio" value="monthly" checked={selectedBilling === "monthly"} onChange={(e) => setSelectedBilling(e.target.value as any)} />
                      <span>{t("monthly")}</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" value="yearly" checked={selectedBilling === "yearly"} onChange={(e) => setSelectedBilling(e.target.value as any)} />
                      <span>{t("yearly")}</span>
                    </label>
                  </div>

                  <div className="mb-4 space-y-2">
                    <p className="text-sm font-medium">{t("prorationMode")}:</p>
                    <select
                      value={prorationType}
                      onChange={(e) => setProrationType(e.target.value as any)}
                      className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                    >
                      <option value="prorated_immediately">{t("prorationImmediate")}</option>
                      <option value="prorated_next_billing_period">{t("prorationNextCycle")}</option>
                      <option value="do_not_bill">{t("prorationNone")}</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={resetUpgradeModal} className="flex-1 rounded border border-gray-300 px-4 py-2 font-semibold dark:border-gray-600">
                      {t("cancel")}
                    </button>
                    <button onClick={handlePreviewChange} disabled={!selectedNewTier || loadingPreview} className="flex-1 rounded bg-brand-deep px-4 py-2 font-semibold text-white disabled:opacity-50">
                      {loadingPreview ? <Loader2 className="inline h-4 w-4 animate-spin" /> : t("viewSummary")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="mb-4 text-lg font-semibold">{t("confirmPlanChange")}</h3>

                  <div className="mb-4 rounded-md bg-gray-50 p-4 text-sm dark:bg-gray-700/50">
                    <p className="mb-2">
                      {t("newPlanLabel")}: <span className="font-semibold">{selectedNewTier}</span> ({selectedBilling === "monthly" ? t("monthly") : t("yearly")})
                    </p>

                    {previewData?.previewAvailable ? (
                      <>
                        {previewData.result?.action === "charge" && (
                          <p className="font-semibold text-amber-700 dark:text-amber-400">
                            {t("chargeNowLabel")}: {formatMinorAmount(previewData.result.amount, previewData.currencyCode || "USD")}
                          </p>
                        )}
                        {previewData.result?.action === "credit" && (
                          <p className="font-semibold text-green-700 dark:text-green-400">
                            {t("creditReceivedLabel")}: {formatMinorAmount(previewData.result.amount, previewData.currencyCode || "USD")}
                          </p>
                        )}
                        {previewData.result?.action === "none" && (
                          <p className="font-semibold text-gray-700 dark:text-gray-300">{t("noImmediateChargeOrCredit")}</p>
                        )}

                        {previewData.recurringTotal && (
                          <p className="mt-2 text-gray-600 dark:text-gray-400">
                            {t("newRecurringTotal")}: {formatMinorAmount(previewData.recurringTotal, previewData.currencyCode || "USD")}
                            {selectedBilling === "monthly" ? t("perMonth") : t("perYear")}
                          </p>
                        )}
                        {previewData.nextBillDate && (
                          <p className="text-gray-600 dark:text-gray-400">
                            {t("nextBillingDate")}: {new Date(previewData.nextBillDate).toLocaleDateString("es-AR")}
                            {previewData.nextBillTotal ? ` — ${formatMinorAmount(previewData.nextBillTotal, previewData.currencyCode || "USD")}` : ""}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-600 dark:text-gray-400">
                        {t("prorationUnavailable")}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => setModalStep("select")} className="flex-1 rounded border border-gray-300 px-4 py-2 font-semibold dark:border-gray-600">
                      {t("back")}
                    </button>
                    <button onClick={handleUpgradeSubscription} disabled={updatingSubscription} className="flex-1 rounded bg-brand-deep px-4 py-2 font-semibold text-white disabled:opacity-50">
                      {updatingSubscription ? <Loader2 className="inline h-4 w-4 animate-spin" /> : t("confirmChange")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      ) : null}

      {/* Payment Method Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t("paymentMethod")}</h2>
          <button
            onClick={handleUpdatePaymentMethod}
            className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
            disabled={updatingSubscription || !billingInfo?.paddleSubscriptionId}
          >
            {t("update")}
            <ExternalLink className="ml-2 inline h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t("paymentMethodHint")}</p>
      </div>

      {/* Cancel Subscription Card */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-900/20">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-red-900 dark:text-red-300">{t("cancelSubscription")}</h2>
            <p className="mt-1 text-sm text-red-800 dark:text-red-400">{t("cancelSubscriptionIrreversible")}</p>
          </div>
          {billingInfo?.status !== "CANCELED" && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={updatingSubscription}
            >
              <Trash2 className="inline mr-2 h-4 w-4" />
              {t("cancel")}
            </button>
          )}
        </div>

        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-96 rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
              <h3 className="mb-4 text-lg font-semibold text-red-900 dark:text-red-300">{t("cancelSubscriptionConfirmTitle")}</h3>
              <p className="mb-6 text-gray-700 dark:text-gray-300">{t("cancelSubscriptionConfirmBody")}</p>
              <div className="flex gap-2">
                <button onClick={() => setShowCancelModal(false)} className="flex-1 rounded border border-gray-300 px-4 py-2 font-semibold dark:border-gray-600">
                  {t("cancelSubscriptionKeepIt")}
                </button>
                <button onClick={handleCancelSubscription} disabled={updatingSubscription} className="flex-1 rounded bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {updatingSubscription ? <Loader2 className="inline h-4 w-4 animate-spin" /> : t("cancelSubscriptionConfirmButton")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Invoice History */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-xl font-semibold">{t("invoiceHistory")}</h2>
        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 text-left font-semibold">{t("colDate")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("colAmount")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("colStatus")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("colTransaction")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700">
                    <td className="px-4 py-3">{new Date(invoice.billedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-semibold">
                      {invoice.currency} {Number(invoice.amount ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${
                          invoice.status === "completed"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                        }`}
                      >
                        {invoice.status === "completed" ? t("invoiceStatusCompleted") : invoice.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{invoice.transactionId?.slice(-8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400">{t("noInvoices")}</p>
        )}
      </div>
    </div>
  );
}
