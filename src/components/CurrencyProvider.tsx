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

    /**
     * `new Decimal(undefined)` lanza `[DecimalError] Invalid argument`, y como
     * esto corre en render, un solo campo faltante en una respuesta de API
     * tumbaba el árbol de React entero: la página quedaba en blanco.
     *
     * El guard va acá y no en cada llamador porque todos pasan por este punto
     * -- hay más de 200 `format(...)` en la UI y cualquiera de ellos puede
     * recibir un número que el backend no calculó. Un importe ausente debe
     * mostrarse como 0, no romper la pantalla.
     *
     * Se loguea en desarrollo para que el dato faltante igual se note y se
     * arregle en el origen, en vez de quedar tapado por el 0.
     */
    const toDecimal = useCallback((amountUSD: unknown, caller: string): Decimal => {
        const n = typeof amountUSD === "string" ? Number(amountUSD) : amountUSD;
        if (typeof n !== "number" || !Number.isFinite(n)) {
            if (process.env.NODE_ENV !== "production") {
                console.warn(`[CurrencyProvider] ${caller}() recibió un importe no numérico:`, amountUSD);
            }
            return new Decimal(0);
        }
        return new Decimal(n);
    }, []);

    const convert = useCallback((amountUSD: number | string) => {
        return toDecimal(amountUSD, "convert").mul(rate).toNumber();
    }, [rate, toDecimal]);

    const format = useCallback((amountUSD: number | string, opts?: { compact?: boolean; fractionDigits?: number }) => {
        const value = toDecimal(amountUSD, "format").mul(rate);
        const defaultFractionDigits = NO_DECIMALS.has(currency) ? 0 : 2;
        let fractionDigits = opts?.fractionDigits ?? defaultFractionDigits;
        if (!opts?.fractionDigits && value.greaterThan(0) && value.lessThan(0.01) && !NO_DECIMALS.has(currency)) {
            fractionDigits = 4;
        }
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
    }, [currency, rate, toDecimal]);

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
            loading: false, convert: (n: number | string) => (Number.isFinite(Number(n)) ? Number(n) : 0),
            format: (n: number | string, opts?: { compact?: boolean; fractionDigits?: number }) => {
                const v = Number(n);
                return `$${(Number.isFinite(v) ? v : 0).toFixed(opts?.fractionDigits ?? 2)}`;
            },
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
