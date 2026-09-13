"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import {
    IconShoppingBag,
    IconSparkles,
    IconClock,
    IconCheck,
    IconCalendarTime,
    IconCircleCheckFilled,
    IconLoader2,
    IconLayersLinked,
    IconBolt,
    IconChartDots,
    IconFileText,
    IconUsers,
    IconPlus,
    IconShieldCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import type { AddonProduct } from "@/lib/addonCatalog";
import { useRouter } from "@/i18n/routing";
import type { ActiveTenantAddon } from "@/services/tenantAddons.service";

interface AddonsMarketplaceProps {
    tenantId: string;
    isMock: boolean;
    currentTier?: string;
    className?: string;
}

export default function AddonsMarketplace({
    tenantId,
    isMock,
    currentTier = "Professional",
    className = "mt-8",
}: AddonsMarketplaceProps) {
    const t = useTranslations("AddonsMarketplace");
    const { instance, accounts } = useMsal();
    const userEmail = accounts?.[0]?.username;

    const router = useRouter();
    const [paddle, setPaddle] = useState<Paddle | null>(null);
    const [catalog, setCatalog] = useState<AddonProduct[]>([]);
    const [activeAddons, setActiveAddons] = useState<ActiveTenantAddon[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState<"all" | "feature" | "quota">("all");
    const [selectedDurations, setSelectedDurations] = useState<Record<string, number>>({});
    const [purchasingKey, setPurchasingKey] = useState<string | null>(null);
    // Motivo por el que no hay nada que ofrecer (hoy solo: el tenant factura por
    // el marketplace de Microsoft). Sin esto la pantalla quedaba vacia sin explicar nada.
    const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
    // El tier que MANDA es el que devuelve la API: sale de `Tenants.tier`, que es
    // la misma fuente que decide que se puede comprar y que autoriza el acceso.
    // La prop viene de `selectedTenant` (contexto del cliente, persistido en
    // localStorage) y puede quedar vieja: mostraba el banner "tu plan Enterprise"
    // sobre un catalogo filtrado como Professional, en la misma pantalla.
    const [tierDelServidor, setTierDelServidor] = useState<string | null>(null);
    const tierEfectivo = tierDelServidor || currentTier;

    const getProductName = (key: string, fallbackName?: string) => {
        try {
            const translated = t(`product_${key}_name`);
            return translated && !translated.startsWith("product_") ? translated : fallbackName || key;
        } catch {
            return fallbackName || key;
        }
    };

    const getProductDesc = (key: string, fallbackDesc?: string) => {
        try {
            const translated = t(`product_${key}_desc`);
            return translated && !translated.startsWith("product_") ? translated : fallbackDesc || "";
        } catch {
            return fallbackDesc || "";
        }
    };

    const getProductUnit = (key: string, fallbackUnit?: string) => {
        try {
            const translated = t(`product_${key}_unit`);
            return translated && !translated.startsWith("product_") ? translated : fallbackUnit || "slot";
        } catch {
            return fallbackUnit || "slot";
        }
    };

    // Inicializar Paddle SDK
    useEffect(() => {
        const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "";
        if (!token) return;
        const env = token.startsWith("test_") ? "sandbox" : "production";
        initializePaddle({
            environment: env,
            token,
            eventCallback: (data) => {
                if (data.name === "checkout.completed") {
                    toast.success(t("status_active"));
                    loadMarketplace();
                }
            },
        }).then((instance) => {
            if (instance) setPaddle(instance);
        }).catch((err) => {
            console.warn("[AddonsMarketplace] Error initializing Paddle:", err);
        });
    }, [t]);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts, isMock]);

    const loadMarketplace = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/billing/marketplace?tenantId=${encodeURIComponent(tenantId)}`, {
                headers: await authHeaders(),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Error cargando catálogo de marketplace");
            }
            setCatalog(data.catalog || []);
            setActiveAddons(data.activeAddons || []);
            setUnavailableReason(data.unavailableReason || null);
            if (data.currentTier) setTierDelServidor(data.currentTier);

            // Duraciones iniciales por default a 1 mes
            const initialDurations: Record<string, number> = {};
            (data.catalog || []).forEach((prod: AddonProduct) => {
                initialDurations[prod.key] = 1;
            });
            setSelectedDurations(initialDurations);
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [tenantId, authHeaders]);

    useEffect(() => {
        loadMarketplace();
    }, [loadMarketplace]);

    const handleDurationChange = (addonKey: string, months: number) => {
        setSelectedDurations((prev) => ({
            ...prev,
            [addonKey]: months,
        }));
    };

    const handlePurchase = async (addonKey: string, isRecurring = false) => {
        setPurchasingKey(addonKey);
        try {
            const months = selectedDurations[addonKey] || 1;
            const product = catalog.find((p) => p.key === addonKey);
            if (!product) return;

            // Add-ons que NO pasan por el checkout: se contratan modificando la
            // suscripcion existente. Abrir el checkout crearia una segunda
            // suscripcion, y como el webhook FIJA la capacidad desde los items,
            // la proxima actualizacion de la principal la pondria en cero.
            if (product.fulfilledBy === "capacity" && product.fulfillmentHref) {
                router.push(product.fulfillmentHref);
                return;
            }

            // En modo Mock o Demo sin pasarela real conectada
            if (isMock) {
                const res = await fetch("/api/billing/marketplace", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(await authHeaders()),
                    },
                    body: JSON.stringify({
                        tenantId,
                        addonKey,
                        addonType: isRecurring ? "recurring" : "pass",
                        months,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || "No se pudo activar el add-on en demo");
                }
                toast.success(t("toast_success_mock"));
                await loadMarketplace();
                return;
            }

            // En modo Real / Sandbox con Paddle
            let priceId: string | undefined;
            if (isRecurring) {
                priceId = product.prices.monthly;
            } else {
                if (months === 1) priceId = product.prices.pass1m;
                else if (months === 3) priceId = product.prices.pass3m;
                else if (months === 6) priceId = product.prices.pass6m;
                else if (months === 9) priceId = product.prices.pass9m;
                else if (months === 12) priceId = product.prices.pass12m || product.prices.annual;
            }

            if (!priceId) {
                toast.error("El identificador de precio (Price ID) no está configurado para este período.");
                return;
            }

            if (!paddle) {
                toast.error(t("toast_paddle_unavailable"));
                return;
            }

            toast.info(t("toast_paddle_loading"));
            paddle.Checkout.open({
                items: [{ priceId, quantity: 1 }],
                customData: {
                    tenant_id: tenantId,
                    addon_key: product.key,
                    addon_type: isRecurring ? "recurring" : "pass",
                    months,
                },
                customer: userEmail ? { email: userEmail } : undefined,
                settings: {
                    displayMode: "overlay",
                    theme: "light",
                },
            });
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setPurchasingKey(null);
        }
    };

    const getIconForAddon = (key: string) => {
        switch (key) {
            case "feature_simulator":
                return <IconChartDots className="w-5 h-5 text-[#0078D4]" />;
            case "feature_zombies_deep":
                return <IconBolt className="w-5 h-5 text-amber-500" />;
            case "feature_pdf_reports":
                return <IconFileText className="w-5 h-5 text-emerald-500" />;
            case "quota_subscriptions":
                return <IconLayersLinked className="w-5 h-5 text-blue-500" />;
            case "quota_user_seats":
                return <IconUsers className="w-5 h-5 text-purple-500" />;
            default:
                return <IconSparkles className="w-5 h-5 text-cyan-500" />;
        }
    };

    const filteredCatalog = catalog.filter((item) => {
        if (activeFilter === "all") return true;
        return item.category === activeFilter;
    });

    const getPassPrice = (product: AddonProduct, months: number): number => {
        switch (months) {
            case 1:
                return product.basePriceUSD.pass1m;
            case 3:
                return product.basePriceUSD.pass3m;
            case 6:
                return product.basePriceUSD.pass6m;
            case 9:
                return product.basePriceUSD.pass9m;
            case 12:
                return product.basePriceUSD.pass12m;
            default:
                return product.basePriceUSD.pass1m;
        }
    };

    return (
        <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md p-6 shadow-sm ${className}`}>
            {/* Header del Marketplace */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200/70 dark:border-slate-800/70">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-[#0078D4]/10 text-[#0078D4]">
                            <IconShoppingBag className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight font-['Montserrat',sans-serif]">
                            {t("title")}
                        </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                        {t("subtitle")}
                    </p>
                </div>

                {/* Filtros de Categoría */}
                <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 self-start md:self-auto">
                    <button
                        type="button"
                        onClick={() => setActiveFilter("all")}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                            activeFilter === "all"
                                ? "bg-[#0078D4] text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                    >
                        {t("filter_all", { count: catalog.length })}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveFilter("feature")}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                            activeFilter === "feature"
                                ? "bg-[#0078D4] text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                    >
                        {t("filter_features")}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveFilter("quota")}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                            activeFilter === "quota"
                                ? "bg-[#0078D4] text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                    >
                        {t("filter_quotas")}
                    </button>
                </div>
            </div>

            {/* El tenant factura por Microsoft: los modulos no se venden por este canal */}
            {unavailableReason === "azure_marketplace" && (
                <div className="mt-6 p-4 rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 flex items-start gap-3">
                    <IconShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        {t("unavailable_azure_marketplace")}
                    </p>
                </div>
            )}

            {/* Banner Informativo si el plan es Enterprise */}
            {tierEfectivo?.toUpperCase() === "ENTERPRISE" && (
                <div className="mt-6 p-4 rounded-xl border border-[#0078D4]/30 bg-[#0078D4]/5 dark:bg-[#0078D4]/10 flex items-start gap-3">
                    <IconShieldCheck className="w-5 h-5 text-[#0078D4] shrink-0 mt-0.5" />
                    <div>
                        <span className="text-xs font-bold text-[#0078D4] uppercase tracking-wider block">
                            {t("enterprise_plan_badge")}
                        </span>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 leading-relaxed">
                            {t("enterprise_plan_banner_desc")}
                        </p>
                    </div>
                </div>
            )}

            {/* Listado de Addons Activos del Tenant (Fondo limpio sin tinte verde molesto) */}
            {activeAddons.length > 0 && (
                <div className="my-6 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
                    <div className="flex items-center gap-2 mb-3">
                        <IconCircleCheckFilled className="w-4 h-4 text-[#0078D4]" />
                        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                            {t("active_title", { count: activeAddons.length })}
                        </h4>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeAddons.map((addon) => {
                            const expires = addon.expiresAt ? new Date(addon.expiresAt) : null;
                            const daysLeft = expires
                                ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (1000 * 3600 * 24)))
                                : null;

                            return (
                                <div
                                    key={addon.id}
                                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shadow-2xs"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 rounded-lg bg-[#0078D4]/10 text-[#0078D4]">
                                            {getIconForAddon(addon.addonKey)}
                                        </div>
                                        <div>
                                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                                {getProductName(addon.addonKey, addon.name)}
                                            </div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                                                <IconClock className="w-3 h-3 text-slate-400" />
                                                {addon.addonType === "pass" && expires ? (
                                                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                                                        {t("pass_days_remaining", { days: daysLeft ?? 0 })}
                                                    </span>
                                                ) : (
                                                    <span className="text-[#0078D4] font-medium">
                                                        {t("subscription_active")}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#0078D4]/10 text-[#0078D4] uppercase tracking-wide">
                                        {t("status_active")}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Grid de Catálogo de Addons */}
            {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                    <IconLoader2 className="w-6 h-6 animate-spin text-[#0078D4]" />
                    <span className="text-xs">{t("loading")}</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-6">
                    {filteredCatalog.map((product) => {
                        const activeItem = activeAddons.find(
                            (a) => a.addonKey === product.key && a.status === "active"
                        );
                        const isPurchasing = purchasingKey === product.key;
                        const currentMonths = selectedDurations[product.key] || 1;
                        const passPrice = getPassPrice(product, currentMonths);

                        return (
                            <div
                                key={product.key}
                                className={`rounded-xl border p-5 flex flex-col justify-between transition-all duration-200 ${
                                    activeItem
                                        ? "border-[#0078D4] dark:border-[#0078D4] ring-1 ring-[#0078D4]/30 bg-white dark:bg-slate-900/50 shadow-sm"
                                        : "border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md"
                                }`}
                            >
                                <div>
                                    {/* Cabecera de la Tarjeta */}
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
                                                {getIconForAddon(product.key)}
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                                                    {getProductName(product.key, product.name)}
                                                </h4>
                                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                                    {product.category === "feature"
                                                        ? t("category_feature")
                                                        : t("category_quota", {
                                                              qty: product.extraQuantity || 1,
                                                              unit: getProductUnit(product.key, product.unit),
                                                          })}
                                                </span>
                                            </div>
                                        </div>
                                        {activeItem && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20">
                                                {t("status_active")}
                                            </span>
                                        )}
                                    </div>

                                    {/* Descripción */}
                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4 min-h-[36px]">
                                        {getProductDesc(product.key, product.description)}
                                    </p>

                                    {/* Selector de Pases Temporales (1m, 3m, 6m, 9m, 12m) */}
                                    <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/50">
                                        <div className="flex items-center justify-between text-[11px] font-medium text-slate-900 dark:text-slate-100 mb-2">
                                            <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                                                <IconCalendarTime className="w-3.5 h-3.5 text-[#0078D4]" />
                                                {t("pass_duration_label")}
                                            </span>
                                            <span className="font-bold text-[#0078D4]">
                                                ${passPrice} {product.currency || "USD"}
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal ml-1">
                                                    (${Math.round(passPrice / currentMonths)}
                                                    {t("per_month_suffix")})
                                                </span>
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-5 gap-1.5">
                                            {[1, 3, 6, 9, 12].map((m) => (
                                                <button
                                                    key={m}
                                                    type="button"
                                                    onClick={() => handleDurationChange(product.key, m)}
                                                    className={`py-1 text-[11px] font-bold rounded-md transition-all ${
                                                        currentMonths === m
                                                            ? "bg-[#0078D4] text-white shadow-2xs"
                                                            : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                                    }`}
                                                >
                                                    {m}m
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Acciones de Compra con texto blanco y alto contraste */}
                                <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
                                    {tierEfectivo?.toUpperCase() === "ENTERPRISE" ? (
                                        <div className="w-full py-2.5 px-3 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] dark:text-blue-300 text-center border border-blue-200/60 dark:border-blue-800/60 flex items-center justify-center gap-1.5">
                                            <IconShieldCheck className="w-4 h-4 text-[#0078D4]" />
                                            <span>{t("included_in_enterprise")}</span>
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isPurchasing}
                                                onClick={() => handlePurchase(product.key, false)}
                                                className="w-full py-2.5 px-3 rounded-lg text-xs font-bold bg-[#0078D4] hover:bg-[#0054A6] text-white flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                                            >
                                                {isPurchasing ? (
                                                    <IconLoader2 className="w-4 h-4 animate-spin text-white" />
                                                ) : (
                                                    <IconPlus className="w-4 h-4 text-white" stroke={2.5} />
                                                )}
                                                <span className="text-white">
                                                    {activeItem
                                                        ? t("button_extend_pass", {
                                                              months: currentMonths,
                                                              price: passPrice,
                                                          })
                                                        : t("button_activate_pass", {
                                                              months: currentMonths,
                                                              price: passPrice,
                                                          })}
                                                </span>
                                            </button>

                                            <button
                                                type="button"
                                                disabled={isPurchasing || (activeItem && activeItem.addonType === "recurring")}
                                                onClick={() => handlePurchase(product.key, true)}
                                                className="w-full py-1.5 px-3 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                            >
                                                <span>
                                                    {t("button_add_subscription", {
                                                        price: product.basePriceUSD.monthly,
                                                    })}
                                                </span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
