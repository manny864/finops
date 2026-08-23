"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import {
    SaaSInvoiceItem,
    TenantBillingDetails,
    SaaSPlanTier,
} from "@/types/saasBilling.types";
import {
    IconCreditCard,
    IconShieldCheck,
    IconExternalLink,
    IconAlertTriangle,
    IconDownload,
    IconCircleCheck,
    IconInfoCircle,
    IconArrowsExchange,
    IconColumns,
    IconLoader2,
    IconRefresh,
    IconSparkles,
    IconTrash,
    IconChevronLeft,
    IconChevronRight,
    IconSearch,
    IconCheck,
    IconMail,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "invoiceNumber", label: "Número de Factura", visible: true, width: 220 },
    { id: "billingDate", label: "Fecha de Emisión", visible: true, width: 180 },
    { id: "amountUSD", label: "Monto (USD)", visible: true, width: 160 },
    { id: "status", label: "Estado", visible: true, width: 140 },
    { id: "actions", label: "Acciones", visible: true, width: 140 },
];

export default function BillingPanel() {
    const t = useTranslations("AdminBilling");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [billingData, setBillingData] = useState<TenantBillingDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Modal de cancelación
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [canceling, setCanceling] = useState(false);
    const [canceledMessage, setCanceledMessage] = useState<string | null>(null);

    // Modal de cambio de plan (para Pro / Business)
    const [showChangePlanModal, setShowChangePlanModal] = useState(false);
    const [selectedTierToChange, setSelectedTierToChange] = useState<SaaSPlanTier>("Business");
    const [changingPlan, setChangingPlan] = useState(false);

    // Portal de cliente
    const [loadingPortal, setLoadingPortal] = useState(false);

    // Tabla de facturas: Búsqueda y Paginación CMP
    const [searchTerm, setSearchTerm] = useState("");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_billing_invoices_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) return JSON.parse(saved);
            } catch {
                /* noop */
            }
        }
        return DEFAULT_COLUMNS;
    });
    const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
    const columnPickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columns));
            } catch {
                /* noop */
            }
        }
    }, [columns, storageKey]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (columnPickerRef.current && !columnPickerRef.current.contains(event.target as Node)) {
                setIsColumnPickerOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || !accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts, isMock]);

    // Cargar datos de facturación
    const loadBilling = useCallback(async () => {
        if (!tenantId || tenantId === "default") {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? `/api/admin/billing?tenantId=${tenantId}&mock=true`
                : `/api/admin/billing?tenantId=${tenantId}`;

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al cargar la información de facturación");
            }

            setBillingData({
                tenantId: json.tenantId || tenantId,
                planTier: json.planTier || "Enterprise",
                status: json.status || "ACTIVE",
                billingCycle: json.billingCycle || "MONTHLY",
                paymentGateway: json.paymentGateway || "PADDLE",
                currentPeriodStartIso: json.currentPeriodStartIso,
                currentPeriodEndIso: json.currentPeriodEndIso || new Date(Date.now() + 30 * 86400000).toISOString(),
                cancelAtPeriodEnd: Boolean(json.cancelAtPeriodEnd),
                isEnterprise: json.isEnterprise !== undefined ? json.isEnterprise : json.planTier === "Enterprise",
                invoices: json.invoices || [],
            });
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [tenantId, isMock, getAuthHeaders]);

    useEffect(() => {
        loadBilling();
    }, [loadBilling]);

    // Redirección al Portal de Cliente
    const handleOpenCustomerPortal = async () => {
        setLoadingPortal(true);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? `/api/admin/billing/customer-portal?tenantId=${tenantId}&mock=true`
                : `/api/admin/billing/customer-portal?tenantId=${tenantId}`;

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (json.success && json.portalUrl) {
                window.open(json.portalUrl, "_blank", "noopener,noreferrer");
            } else {
                throw new Error(json.error || "No se pudo generar la sesión del portal de cliente");
            }
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoadingPortal(false);
        }
    };

    // Cancelar Suscripción
    const handleConfirmCancel = async () => {
        setCanceling(true);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const res = await fetch("/api/admin/billing/cancel-subscription", {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "No se pudo procesar la cancelación");
            }

            setCanceledMessage(json.message || "Cancelación programada para fin de período.");
            setShowCancelModal(false);
            await loadBilling();
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setCanceling(false);
        }
    };

    // Redimensionamiento de Columnas
    const handleResizeMouseDown = (columnId: string, e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const targetCol = columns.find((c) => c.id === columnId);
        if (!targetCol) return;
        const startWidth = targetCol.width;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = Math.max(100, Math.min(600, startWidth + delta));
            setColumns((prev) => prev.map((col) => (col.id === columnId ? { ...col, width: newWidth } : col)));
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const toggleColumnVisibility = (columnId: string) => {
        setColumns((prev) =>
            prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col))
        );
    };

    const resetColumnsToDefault = () => {
        setColumns(DEFAULT_COLUMNS);
    };

    // Filtrado y Paginado de Facturas
    const filteredInvoices = useMemo(() => {
        const list = billingData?.invoices || [];
        if (!searchTerm.trim()) return list;
        const q = searchTerm.toLowerCase();
        return list.filter(
            (inv) =>
                inv.invoiceNumber.toLowerCase().includes(q) ||
                inv.formattedDate.toLowerCase().includes(q) ||
                String(inv.amountUSD).includes(q) ||
                inv.status.toLowerCase().includes(q)
        );
    }, [billingData?.invoices, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
    const paginatedInvoices = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredInvoices.slice(start, start + pageSize);
    }, [filteredInvoices, currentPage, pageSize]);

    const currentTier = billingData?.planTier || "Enterprise";
    const isEnterprise = billingData?.isEnterprise || currentTier.toLowerCase() === "enterprise";

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Subtítulo de Sección */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconCreditCard size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Facturación"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Gestioná el plan de suscripción SaaS de tu organización, método de pago, pasarela de cobro e historial de facturas fiscales."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        Gestioná el plan contratado, tus métodos de pago con Paddle o Stripe y el historial descargable de facturas fiscales.
                    </p>
                </div>

                {isMock && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <IconSparkles size={14} />
                        <span>Modo Demostración</span>
                    </div>
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconAlertTriangle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* Banner Éxito Cancelación */}
            {canceledMessage && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-[#0078D4] dark:text-blue-300 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconInfoCircle size={16} />
                    <span>{canceledMessage}</span>
                </div>
            )}

            {/* ─── BLOQUE 1: Tarjeta Plan Actual (Ancho 100%) ─────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("tier") || "Tier"}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                            <IconShieldCheck size={22} className="text-[#0078D4]" />
                            <h2 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                {currentTier}
                            </h2>
                        </div>
                    </div>

                    <div className="flex flex-col sm:items-end">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("status") || "Estado"}
                        </span>
                        <div className="mt-1">
                            {billingData?.cancelAtPeriodEnd ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                    <IconAlertTriangle size={13} />
                                    <span>Cancela fin de período</span>
                                </span>
                            ) : billingData?.status === "ACTIVE" ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                    <IconCircleCheck size={13} />
                                    <span>Activa</span>
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-400">
                                    {billingData?.status || "Activa"}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Callout Informativo Dinámico por Tier */}
                <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 p-4 rounded-xl flex items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
                    <IconInfoCircle size={18} className="text-[#0078D4] shrink-0" />
                    <p className="leading-relaxed">
                        {isEnterprise ? (
                            <span>
                                Tu plan <strong>Enterprise</strong> incluye suscripciones de Azure ilimitadas, usuarios ilimitados y soporte prioritario 24/7 con SLA de respuesta en 4 h.
                            </span>
                        ) : currentTier === "Business" ? (
                            <span>
                                Tu plan <strong>Business</strong> incluye hasta 15 suscripciones de Azure, exportaciones FOCUS 1.1 y soporte prioritario con SLA de 8 h.
                            </span>
                        ) : (
                            <span>
                                Tu plan <strong>Professional</strong> incluye hasta 3 suscripciones de Azure y reportes ejecutivos con IA.
                            </span>
                        )}
                    </p>
                </div>
            </div>

            {/* ─── BLOQUE 2: Tarjeta Cambiar Plan (Ancho 100%) ─────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <IconArrowsExchange size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("changePlan") || "Cambiar Plan"}
                    </h2>
                </div>

                {isEnterprise ? (
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 p-4 rounded-xl text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-3">
                        <IconMail size={18} className="text-[#0078D4] shrink-0 mt-0.5" />
                        <div>
                            <p>
                                Tu organización cuenta con el plan <strong>Enterprise</strong>, sujeto a condiciones y acuerdos personalizados.
                            </p>
                            <p className="mt-1">
                                Para modificar tu suscripción o sumar nuevos entornos, contactá a nuestro equipo comercial en{" "}
                                <a
                                    href="mailto:ventas@cscloudsolutions.com.ar"
                                    className="text-[#0078D4] dark:text-blue-400 font-semibold underline"
                                >
                                    ventas@cscloudsolutions.com.ar
                                </a>
                                .
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div>
                            <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                                ¿Deseas escalar a Business o Enterprise?
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                                Aumenta límites de suscripciones, soporte y módulos avanzados de gobernanza.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowChangePlanModal(true)}
                            className="inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all"
                        >
                            <span>Modificar Suscripción</span>
                        </button>
                    </div>
                )}
            </div>

            {/* ─── BLOQUE 3: Tarjeta Método de Pago (Ancho 100%) ───────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <IconCreditCard size={18} stroke={1.5} className="text-[#0078D4]" />
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("paymentMethod") || "Método de Pago"}
                        </h2>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
                        Accedé al portal seguro de pago para actualizar tu tarjeta de crédito, método de facturación o datos fiscales.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleOpenCustomerPortal}
                    disabled={loadingPortal}
                    className="inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all shrink-0 disabled:opacity-50"
                >
                    {loadingPortal ? (
                        <IconLoader2 size={14} className="animate-spin text-white" />
                    ) : (
                        <IconExternalLink size={14} className="text-white" />
                    )}
                    <span>Actualizar Método de Pago</span>
                </button>
            </div>

            {/* ─── BLOQUE 4: Cancelar Suscripción (Zona de Peligro) ─────────────────── */}
            <div className="border border-rose-200 dark:border-rose-900/50 bg-rose-50/20 dark:bg-rose-950/10 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <IconAlertTriangle size={18} stroke={1.5} className="text-rose-600" />
                        <h2 className="font-bold text-sm text-rose-700 dark:text-rose-400 font-['Montserrat',sans-serif]">
                            {t("cancelSubscription") || "Cancelar Suscripción"}
                        </h2>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
                        Al cancelar, conservarás el acceso a tus funciones FinOps hasta el final del período de facturación actual. Esta acción no se puede deshacer.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    disabled={billingData?.cancelAtPeriodEnd}
                    className="inline-flex items-center justify-center gap-1.5 bg-rose-600 text-white hover:bg-rose-700 px-4 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <IconTrash size={14} className="text-white" />
                    <span>{billingData?.cancelAtPeriodEnd ? "Cancelación Programada" : "Cancelar Suscripción"}</span>
                </button>
            </div>

            {/* ─── BLOQUE 5: Tabla Historial de Facturas (Estándar CMP) ─────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Cabecera y Controles */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("invoiceHistory") || "Historial de Facturas"} ({filteredInvoices.length})
                        </h2>
                        <button
                            onClick={loadBilling}
                            className="p-1 text-slate-400 hover:text-[#0078D4] rounded transition-colors"
                            title="Refrescar facturas"
                        >
                            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        {/* Buscador */}
                        <div className="relative flex-1 sm:w-56">
                            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder="Buscar facturas..."
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        {/* Selector de Columnas (z-[100]) */}
                        <div className="relative" ref={columnPickerRef}>
                            <button
                                type="button"
                                onClick={() => setIsColumnPickerOpen((prev) => !prev)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                            >
                                <IconColumns size={15} stroke={1.5} className="text-[#0078D4]" />
                                <span>Personalizar Columnas</span>
                            </button>

                            {isColumnPickerOpen && (
                                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[100] p-3 space-y-2 animate-in fade-in">
                                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                                        <span>Columnas Visibles</span>
                                        <button
                                            onClick={resetColumnsToDefault}
                                            className="text-[11px] font-normal text-[#0078D4] hover:underline"
                                        >
                                            Restaurar
                                        </button>
                                    </div>
                                    <div className="space-y-1 max-h-48 overflow-y-auto">
                                        {columns.map((col) => (
                                            <label
                                                key={col.id}
                                                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 p-1.5 rounded cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={col.visible}
                                                    onChange={() => toggleColumnVisibility(col.id)}
                                                    className="rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                                />
                                                <span>{col.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Contenedor de Tabla con Scrollbar visible en macOS */}
                <div className="w-full max-w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                {columns
                                    .filter((c) => c.visible)
                                    .map((col) => (
                                        <th
                                            key={col.id}
                                            style={{ width: `${col.width}px` }}
                                            className="relative px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px] select-none"
                                        >
                                            <span>{col.label}</span>
                                            <div
                                                onMouseDown={(e) => handleResizeMouseDown(col.id, e)}
                                                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#0078D4] transition-colors"
                                            />
                                        </th>
                                    ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                        <div className="inline-flex items-center gap-2">
                                            <IconLoader2 size={16} className="animate-spin text-[#0078D4]" />
                                            <span>Cargando facturas...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedInvoices.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {searchTerm
                                            ? "No se encontraron facturas que coincidan con la búsqueda."
                                            : t("noInvoices") || "No hay facturas disponibles para este tenant."}
                                    </td>
                                </tr>
                            ) : (
                                paginatedInvoices.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {columns.find((c) => c.id === "invoiceNumber")?.visible && (
                                            <td className="px-4 py-3 font-mono font-semibold text-slate-800 dark:text-slate-100">
                                                {inv.invoiceNumber}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "billingDate")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {inv.formattedDate}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "amountUSD")?.visible && (
                                            <td className="px-4 py-3 font-semibold text-[#0078D4] dark:text-blue-400 whitespace-nowrap">
                                                ${inv.amountUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                                    {inv.status === "PAID" ? "Pagada" : inv.status}
                                                </span>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const url = inv.downloadPdfUrl || `/api/billing/invoices/${inv.id}/pdf`;
                                                        window.open(url, "_blank");
                                                    }}
                                                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:text-[#0060AA] transition-colors"
                                                >
                                                    <IconDownload size={14} className="text-[#0078D4]" />
                                                    <span>Descargar PDF</span>
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginación Estándar CMP */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>Mostrar:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>de {filteredInvoices.length} registros</span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronLeft size={14} />
                        </button>
                        <span className="px-3">
                            Página {currentPage} de {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── MODAL: Confirmación de Cancelación de Suscripción (z-[100]) ──────── */}
            {showCancelModal && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl">
                        <div className="text-center space-y-2">
                            <IconAlertTriangle size={44} stroke={1.5} className="text-rose-600 mx-auto" />
                            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                ¿Estás seguro de cancelar tu suscripción?
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                Conservarás el acceso a todas las capacidades de tu plan hasta el final del ciclo de facturación actual (
                                <strong>
                                    {billingData?.currentPeriodEndIso
                                        ? new Date(billingData.currentPeriodEndIso).toLocaleDateString()
                                        : "fin del período"}
                                </strong>
                                ).
                            </p>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setShowCancelModal(false)}
                                disabled={canceling}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                Volver / Conservar Plan
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmCancel}
                                disabled={canceling}
                                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                            >
                                {canceling && <IconLoader2 size={14} className="animate-spin" />}
                                <span>Confirmar Cancelación</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export { BillingPanel as SaaSPlanBillingPanel };
