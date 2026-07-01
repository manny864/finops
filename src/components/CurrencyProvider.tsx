"use client";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import Decimal from "decimal.js";

const SYMBOLS: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", ARS: "AR$", BRL: "R$", MXN: "MX$",
    CLP: "CLP$", COP: "COL$", PEN: "S/", CAD: "CA$", AUD: "AU$",
    JPY: "¥", CHF: "CHF", CNY: "¥", INR: "₹",
};

const CURRENCY_LABELS: Record<string, string> = {
    USD: "🇺🇸 USD — US Dollar",
    EUR: "🇪🇺 EUR — Euro",
    GBP: "🇬🇧 GBP — British Pound",
    ARS: "🇦🇷 ARS — Peso Argentino",
    BRL: "🇧🇷 BRL — Real Brasileño",
    MXN: "🇲🇽 MXN — Peso Mexicano",
    CLP: "🇨🇱 CLP — Peso Chileno",
    COP: "🇨🇴 COP — Peso Colombiano",
    PEN: "🇵🇪 PEN — Sol Peruano",
    CAD: "🇨🇦 CAD — Canadian Dollar",
    AUD: "🇦🇺 AUD — Australian Dollar",
    JPY: "🇯🇵 JPY — Japanese Yen",
    CHF: "🇨🇭 CHF — Swiss Franc",
    CNY: "🇨🇳 CNY — Chinese Yuan",
    INR: "🇮🇳 INR — Indian Rupee",
};

const NO_DECIMALS = new Set(["JPY", "CLP", "COP", "ARS"]);

interface CurrencyContextType {
    currency: string;
    setCurrency: (c: string) => Promise<void>;
    rate: number;
    supported: string[];
    loading: boolean;
    convert: (amountUSD: number | string) => number;
    format: (amountUSD: number | string, opts?: { compact?: boolean; fractionDigits?: number }) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
    const { selectedTenant } = useTenant();
    const { accounts, instance } = useMsal();
    const [currency, setCurrencyState] = useState("USD");
    const [rate, setRate] = useState(1);
    const [supported, setSupported] = useState<string[]>(["USD"]);
    const [loading, setLoading] = useState(false);

    const loadRates = useCallback(async (target: string) => {
        try {
            const r = await fetch(`/api/fx/rates`);
            const j = await r.json();
            if (j.success) {
                setSupported(Object.keys(j.rates));
                const v = j.rates[target];
                if (v && v !== "?") setRate(Number(v));
            }
        } catch { /* keep defaults */ }
    }, []);

    // Populate currency list on mount from the public /api/fx/rates endpoint (no auth needed)
    useEffect(() => { loadRates("USD"); }, [loadRates]);

    useEffect(() => {
        if (!selectedTenant?.id || selectedTenant.id === "default" || accounts.length === 0) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
                const r = await fetch(`/api/fx/preference?tenantId=${selectedTenant.id}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                const j = await r.json();
                if (!cancelled && j.success) {
                    setCurrencyState(j.currency);
                    setSupported(j.supported || ["USD"]);
                    await loadRates(j.currency);
                }
            } catch { /* fallback USD */ }
            finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, accounts.length, loadRates, instance]);

    const setCurrency = useCallback(async (c: string) => {
        setCurrencyState(c);
        await loadRates(c);
        if (selectedTenant?.id && selectedTenant.id !== "default" && accounts.length > 0) {
            try {
                const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
                await fetch(`/api/fx/preference`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ tenantId: selectedTenant.id, currency: c }),
                });
            } catch { /* persist falla silenciosa, queda en sesión */ }
        }
    }, [selectedTenant?.id, accounts, loadRates, instance]);

    const convert = useCallback((amountUSD: number | string) => {
        return new Decimal(amountUSD).mul(rate).toNumber();
    }, [rate]);

    const format = useCallback((amountUSD: number | string, opts?: { compact?: boolean; fractionDigits?: number }) => {
        const value = new Decimal(amountUSD).mul(rate);
        const defaultFractionDigits = NO_DECIMALS.has(currency) ? 0 : 2;
        const fractionDigits = opts?.fractionDigits ?? defaultFractionDigits;
        const num = Number(value.toFixed(fractionDigits));
        try {
            const f = new Intl.NumberFormat("en-US", {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
                notation: opts?.compact ? "compact" : "standard",
            }).format(num);
            return `${SYMBOLS[currency] || currency}${f}`;
        } catch {
            return `${SYMBOLS[currency] || currency}${num.toFixed(fractionDigits)}`;
        }
    }, [currency, rate]);

    return (
        <CurrencyContext.Provider value={{ currency, setCurrency, rate, supported, loading, convert, format }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency() {
    const ctx = useContext(CurrencyContext);
    if (!ctx) {
        // Fallback no-op para componentes fuera del provider (tests, prerender)
        return {
            currency: "USD", setCurrency: async () => {}, rate: 1, supported: ["USD"],
            loading: false, convert: (n: number | string) => Number(n),
            format: (n: number | string, opts?: { compact?: boolean; fractionDigits?: number }) => `$${Number(n).toFixed(opts?.fractionDigits ?? 2)}`,
        } as CurrencyContextType;
    }
    return ctx;
}

export function CurrencySelector({ className }: { className?: string }) {
    const { currency, setCurrency, supported, loading } = useCurrency();
    return (
        <select
            value={currency}
            disabled={loading}
            onChange={(e) => setCurrency(e.target.value)}
            className={className || "border rounded px-2 py-1 text-sm dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 max-w-[10rem]"}
            title="Divisa de visualización"
        >
            {supported.map(c => (
                <option key={c} value={c}>{CURRENCY_LABELS[c] || c}</option>
            ))}
        </select>
    );
}
