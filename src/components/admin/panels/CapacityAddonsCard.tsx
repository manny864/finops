"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { IconStack2, IconLoader2, IconInfoCircle } from "@tabler/icons-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import { ADDON_PRICE_USD } from "@/lib/pricing";

/**
 * Autoservicio de capacidad (MEJ-15 fase 2).
 *
 * La cantidad que se manda es la TOTAL deseada, no un incremento: es el mismo
 * criterio con el que el webhook acredita (ver `paddleAddons.ts`). Así bajar de
 * 4 a 1 es la misma operación que subir, y reintentar no acumula.
 *
 * La capacidad NO se refleja al instante: la escribe el webhook cuando Paddle
 * confirma el cambio. Se avisa en pantalla para que nadie interprete el
 * desfase como un error.
 */

interface Capacity {
  tier: string;
  subscriptions: { used: number; limit: number | null; purchased: number };
  tenantSlots: { purchased: number };
  canPurchase: boolean;
}

type AddonKind = "additional_subscription_slot" | "additional_tenant_slot";

export default function CapacityAddonsCard({ tenantId, isMock }: { tenantId: string; isMock: boolean }) {
    const t = useTranslations("AdminCapacityAddons");
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<Capacity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AddonKind | null>(null);
  const [subsQty, setSubsQty] = useState(0);
  const [tenantsQty, setTenantsQty] = useState(0);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (isMock || accounts.length === 0) return {};
    try {
      const token = await getFreshIdToken(instance, accounts[0]);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [instance, accounts, isMock]);

  const load = useCallback(async () => {
    if (!tenantId || tenantId === "default") return;
    setLoading(true);
    try {
      if (isMock) {
        setData({
          tier: "Enterprise",
          subscriptions: { used: 2, limit: 10, purchased: 0 },
          tenantSlots: { purchased: 0 },
          canPurchase: true,
        });
        setSubsQty(0);
        setTenantsQty(0);
        return;
      }
      const res = await fetch(`/api/billing/addons/capacity?tenantId=${encodeURIComponent(tenantId)}`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t("capacityReadError"));
      setData(json);
      setSubsQty(json.subscriptions.purchased);
      setTenantsQty(json.tenantSlots.purchased);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId, authHeaders, isMock, t]);

  useEffect(() => { load(); }, [load]);

  const apply = async (addonType: AddonKind, quantity: number) => {
    setSaving(addonType);
    try {
      if (isMock) {
        await new Promise((r) => setTimeout(r, 400));
        toast.success(t("addonApplied", { qty: quantity, addon: t(`addon_${addonType}`) }));
        setData((prev) => {
          if (!prev) return prev;
          if (addonType === "additional_subscription_slot") {
            return {
              ...prev,
              subscriptions: { ...prev.subscriptions, purchased: quantity },
            };
          }
          return {
            ...prev,
            tenantSlots: { purchased: quantity },
          };
        });
        return;
      }
      const res = await fetch("/api/billing/addons/capacity", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ tenantId, addonType, quantity }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t("addonError"));
      // El `message` del servidor arma la frase con un ternario y un ADDON_LABEL
      // en castellano. El cliente ya tiene `addonType` y `quantity`, asi que la
      // frase se arma aca y el `message` queda para consumidores de la API.
      toast.success(t("addonApplied", { qty: quantity, addon: t(`addon_${addonType}`) }));
      // Se recarga tras un momento: la capacidad la escribe el webhook.
      setTimeout(load, 3000);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm flex justify-center">
        <IconLoader2 size={18} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (!data) return null;

  const unlimited = data.subscriptions.limit === null;
  const priceSub = ADDON_PRICE_USD.extraSubscription[data.tier];
  const priceTenant = ADDON_PRICE_USD.extraTenant[data.tier];

  const Row = ({ label, help, unitPrice, qty, setQty, current, kind }: {
    label: string; help: string; unitPrice: number | null; qty: number;
    setQty: (n: number) => void; current: number; kind: AddonKind;
  }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{label}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{help}</p>
      </div>
      <div className="flex items-center gap-2">
        {unitPrice !== null && (
          <span className="text-[11px] text-slate-500 whitespace-nowrap">${unitPrice}/mes c/u</span>
        )}
        <input
          type="number"
          min={0}
          max={100}
          value={qty}
          onChange={(e) => setQty(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          className="w-16 px-2 py-1.5 text-xs text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
          aria-label={`Cantidad de ${label}`}
        />
        <button
          type="button"
          onClick={() => apply(kind, qty)}
          disabled={saving !== null || qty === current || !data.canPurchase}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0078D4] text-white hover:bg-[#006cbe] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {saving === kind ? t("applying") : qty < current ? t("reduce") : t("purchase")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-2">
      <div className="flex items-center gap-2">
        <IconStack2 size={18} stroke={1.5} className="text-[#0078D4]" />
        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
          {t("title")}
        </h2>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 pb-1">
        {unlimited
          ? t("unlimitedSubs")
          : t("usageLine", { used: data.subscriptions.used, limit: data.subscriptions.limit ?? 0 })}
      </p>

      {!data.canPurchase ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-300">
          <IconInfoCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            {t("selfServeUnavailable")}
          </span>
        </div>
      ) : (
        <>
          {!unlimited && (
            <Row
              kind="additional_subscription_slot"
              label={t("extraSubscriptions")}
              help={`Se suman a las ${(data.subscriptions.limit ?? 0) - data.subscriptions.purchased} de tu plan.`}
              unitPrice={priceSub}
              qty={subsQty}
              setQty={setSubsQty}
              current={data.subscriptions.purchased}
            />
          )}
          <Row
            kind="additional_tenant_slot"
            label="Tenants adicionales"
            help="Cada uno permite vincular otro directorio de Entra ID al mismo contrato."
            unitPrice={priceTenant}
            qty={tenantsQty}
            setQty={setTenantsQty}
            current={data.tenantSlots.purchased}
          />
          <p className="text-[11px] text-slate-400 pt-2">
            {t("prorationNote")}
          </p>
        </>
      )}
    </div>
  );
}
