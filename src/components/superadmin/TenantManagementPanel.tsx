"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DemoModeBadge from "@/components/DemoModeBadge";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { SUBSCRIPTION_LIMITS } from "@/lib/tierLogic";
import { filterByLifecycleRange, buildLifecycleCsv, type LifecycleDateField } from "@/lib/tenantLifecycleReport";
import {
    SuperAdminTenantItem,
    SaaSPlanTier,
    TenantSubscriptionStatus,
    GeneratePaddleLinkResponse,
    ManualTrialDays,
    MANUAL_TRIAL_DAY_OPTIONS,
} from "@/types/superAdminTenants.types";
import {
    IconBuildingSkyscraper,
    IconBuilding,
    IconCrown,
    IconPackages,
    IconShieldCheck,
    IconLink,
    IconPlus,
    IconSend,
    IconDeviceFloppy,
    IconCopy,
    IconColumns,
    IconSearch,
    IconRefresh,
    IconLoader2,
    IconChevronLeft,
    IconChevronRight,
    IconCheck,
    IconSparkles,
    IconShieldLock,
    IconTrash,
    IconX,
} from "@tabler/icons-react";
import DeleteTenantModal from "@/components/DeleteTenantModal";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const CANCELLATION_REASON_LABEL: Record<string, string> = {
    voluntary_churn: "Baja voluntaria",
    payment_delinquency: "Impago",
    contract_expired: "Contrato vencido",
    admin_deprovisioning: "Baja administrativa",
};

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "company", label: "Empresa", visible: true, width: 220 },
    { id: "tenantId", label: "Tenant ID / GUID", visible: true, width: 220 },
    { id: "subscription", label: "Suscripción", visible: true, width: 140 },
    // MEJ-12. Ocultas por defecto: la tabla ya trae 10 columnas y el selector
    // persiste la elección, así que quien las necesita las prende una vez.
    { id: "activatedAt", label: "Fecha de Alta", visible: false, width: 130 },
    { id: "canceledAt", label: "Fecha de Baja", visible: false, width: 130 },
    { id: "cancellationReason", label: "Motivo de Baja", visible: false, width: 160 },
    { id: "tier", label: "Tier Actual", visible: true, width: 150 },
    { id: "salesRep", label: "Vendedor", visible: true, width: 180 },
    { id: "commission", label: "Comisión (%)", visible: true, width: 120 },
    { id: "saveDeal", label: "Guardar Comercial", visible: true, width: 130 },
    { id: "paddleCheckout", label: "Cobrar vía Paddle", visible: true, width: 240 },
    { id: "impersonate", label: "Acceso / Impersonar", visible: true, width: 140 },
    { id: "actions", label: "Eliminar", visible: true, width: 110 },
];

export default function TenantManagementPanel() {
    const t = useTranslations("SuperAdminTenants");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [tenants, setTenants] = useState<SuperAdminTenantItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingTenantId, setSavingTenantId] = useState<string | null>(null);
    const [generatingLinkId, setGeneratingLinkId] = useState<string | null>(null);
    const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copiedGuid, setCopiedGuid] = useState<string | null>(null);

    // Formulario de creación manual
    const [newEntraId, setNewEntraId] = useState("");
    const [newOrgName, setNewOrgName] = useState("");
    const [newInitialTier, setNewInitialTier] = useState<SaaSPlanTier>("Enterprise");
    // 0 = sin trial (alta directa ACTIVE), que es el comportamiento histórico.
    const [newTrialDays, setNewTrialDays] = useState<ManualTrialDays | 0>(0);
    const [creatingManual, setCreatingManual] = useState(false);

    // Input de Price ID por fila
    const [priceIds, setPriceIds] = useState<Record<string, string>>({});

    // Modal de Checkout Link generado
    const [generatedLinkData, setGeneratedLinkData] = useState<{
        modalOpen: boolean;
        orgName: string;
        checkoutUrl: string;
        copied: boolean;
    } | null>(null);

    // Tabla: Búsqueda y Paginación
    const [searchTerm, setSearchTerm] = useState("");
    // MEJ-12 criterio 3: filtro por rango sobre alta o baja.
    const [lifecycleField, setLifecycleField] = useState<LifecycleDateField>("activatedAtIso");
    const [lifecycleFrom, setLifecycleFrom] = useState("");
    const [lifecycleTo, setLifecycleTo] = useState("");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_superadmin_tenants_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    const parsed: ColumnConfig[] = JSON.parse(saved);
                    const existingIds = new Set(parsed.map((c) => c.id));
                    const missing = DEFAULT_COLUMNS.filter((c) => !existingIds.has(c.id));
                    return [...parsed, ...missing];
                }
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

    // Cargar Tenants
    const loadTenants = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const url = isMock ? "/api/superadmin/tenants?mock=true" : "/api/superadmin/tenants";
            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al cargar tenants");
            }

            const items: SuperAdminTenantItem[] = json.tenants || [];
            setTenants(items);

            // Inicializar state de priceIds
            const initialPrices: Record<string, string> = {};
            items.forEach((item) => {
                if (item.paddlePriceId) {
                    initialPrices[item.tenantId] = item.paddlePriceId;
                }
            });
            setPriceIds(initialPrices);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, getAuthHeaders]);

    useEffect(() => {
        loadTenants();
    }, [loadTenants]);

    // Crear Tenant Manual
    const handleCreateManualTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEntraId.trim() || !newOrgName.trim()) return;

        setCreatingManual(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock ? "/api/superadmin/tenants/create-manual?mock=true" : "/api/superadmin/tenants/create-manual";
            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    entraTenantId: newEntraId.trim(),
                    organizationName: newOrgName.trim(),
                    initialPlanTier: newInitialTier,
                    trialDays: newTrialDays,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al crear tenant");
            }

            if (json.tenant) {
                setTenants((prev) => [json.tenant, ...prev]);
            }
            setNewEntraId("");
            setNewOrgName("");
            setNewInitialTier("Enterprise");
            setNewTrialDays(0);
            await loadTenants();
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setCreatingManual(false);
        }
    };

    // Actualizar Tier / Suscripción
    const handleUpdateTier = async (tenantIdToUpdate: string, newTier: SaaSPlanTier, newStatus: TenantSubscriptionStatus) => {
        // Actualización optimista
        setTenants((prev) =>
            prev.map((t) => (t.tenantId === tenantIdToUpdate ? { ...t, planTier: newTier, subscriptionStatus: newStatus } : t))
        );

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? `/api/superadmin/tenants/${tenantIdToUpdate}/update-tier?mock=true`
                : `/api/superadmin/tenants/${tenantIdToUpdate}/update-tier`;

            await fetch(url, {
                method: "PUT",
                headers,
                body: JSON.stringify({ planTier: newTier, subscriptionStatus: newStatus }),
            });
        } catch (e: any) {
            setError(errorMessage(e));
            await loadTenants();
        }
    };

    // Actualizar Deal Comercial (Vendedor y Comisión)
    const handleSaveCommercialDeal = async (targetTenant: SuperAdminTenantItem) => {
        try {
            setSavingTenantId(targetTenant.tenantId);
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (!isMock && accounts.length > 0) {
                const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
                if (token) headers["Authorization"] = `Bearer ${token}`;
            }

            const res = await fetch(`/api/superadmin/tenants/${encodeURIComponent(targetTenant.tenantId)}/update-commercial`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                    salesRepName: targetTenant.salesRepName,
                    salesCommissionPercent: targetTenant.salesCommissionPercent,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "No se pudo actualizar el acuerdo comercial");
            }

            toast.success(t("commercialUpdated") || "Acuerdo comercial guardado correctamente");
        } catch (err: any) {
            toast.error(errorMessage(err));
        } finally {
            setSavingTenantId(null);
        }
    };

    const handleStartImpersonation = async (targetTenant: SuperAdminTenantItem) => {
        try {
            setImpersonatingId(targetTenant.tenantId);
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (!isMock && accounts.length > 0) {
                const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
                if (token) headers["Authorization"] = `Bearer ${token}`;
            }

            const res = await fetch("/api/superadmin/impersonate/start", {
                method: "POST",
                headers,
                body: JSON.stringify({ targetTenantId: targetTenant.tenantId }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "No se pudo iniciar la sesión de impersonación");
            }

            toast.success(data.message || `Ingresando a ${targetTenant.organizationName || targetTenant.tenantId}...`);
            setTimeout(() => {
                window.location.href = data.redirectUrl || "/";
            }, 300);
        } catch (err: any) {
            toast.error(err?.message || "Error al iniciar impersonación");
            setImpersonatingId(null);
        }
    };

    // Generar Checkout Link de Paddle
    const handleGeneratePaddleLink = async (tenantItem: SuperAdminTenantItem) => {
        const priceId = priceIds[tenantItem.tenantId]?.trim();
        if (!priceId) {
            setError("Debes ingresar un Price ID de Paddle (ej: pri_01h...)");
            return;
        }

        setGeneratingLinkId(tenantItem.tenantId);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/tenants/paddle/generate-checkout-link?mock=true"
                : "/api/superadmin/tenants/paddle/generate-checkout-link";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    tenantId: tenantItem.tenantId,
                    paddlePriceId: priceId,
                }),
            });
            const json: { success: boolean } & GeneratePaddleLinkResponse = await res.json();

            if (!res.ok || !json.success) {
                throw new Error("Error al generar enlace de Paddle");
            }

            setGeneratedLinkData({
                modalOpen: true,
                orgName: tenantItem.organizationName,
                checkoutUrl: json.checkoutUrl,
                copied: false,
            });
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setGeneratingLinkId(null);
        }
    };

    // Copiar al portapapeles
    const handleCopyText = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedGuid(id);
        setTimeout(() => setCopiedGuid(null), 2000);
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

    // Métricas KPI
    const totalTenantsCount = tenants.length;
    const enterpriseCount = tenants.filter((t) => t.planTier === "Enterprise").length;
    const standardCount = tenants.filter((t) => t.planTier === "Business" || t.planTier === "Professional").length;
    const manualBypassCount = tenants.filter((t) => t.isManualBypass).length;

    // Filtrado y Paginado
    const filteredTenants = useMemo(() => {
        const q = searchTerm.toLowerCase().trim();
        const bySearch = !q ? tenants : tenants.filter(
            (t) =>
                t.organizationName.toLowerCase().includes(q) ||
                t.tenantId.toLowerCase().includes(q) ||
                t.entraTenantId.toLowerCase().includes(q) ||
                t.salesRepName.toLowerCase().includes(q)
        );
        // El rango se aplica DESPUÉS del buscador para que los dos filtros se
        // acumulen, que es lo que espera quien arma un informe acotado.
        return filterByLifecycleRange(bySearch, {
            field: lifecycleField,
            from: lifecycleFrom || undefined,
            to: lifecycleTo || undefined,
        });
    }, [tenants, searchTerm, lifecycleField, lifecycleFrom, lifecycleTo]);

    /** Exporta lo que se está viendo (filtros incluidos), no la tabla entera:
     *  el informe contable se pide para un período, no para todo el histórico. */
    const handleExportCsv = () => {
        const csv = buildLifecycleCsv(filteredTenants);
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `ciclo-vida-tenants-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const totalPages = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
    const paginatedTenants = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredTenants.slice(start, start + pageSize);
    }, [filteredTenants, currentPage, pageSize]);

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Subtítulo */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconBuildingSkyscraper size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Gestión de Tenants (SuperAdmin)"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Panel de gobernanza global para provisión manual de cuentas B2B, tiers, comisiones y cobros Enterprise vía Paddle."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Crea tenants manualmente evadiendo la pasarela de pagos, administra los Tiers asignados y gestiona deals Enterprise con Paddle."}
                    </p>
                </div>

                {isMock && (
                    <DemoModeBadge />
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconX size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* ─── 4 TARJETAS KPI SUPERIORES (Tonos de azul corporativo) ─────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Tenants Totales */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiTotalTenants") || "Tenants Totales"}
                        </span>
                        <div className="text-2xl font-bold text-[#0078D4] mt-1 font-['Montserrat',sans-serif]">
                            {totalTenantsCount}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0078D4]">
                        <IconBuilding size={24} stroke={1.5} />
                    </div>
                </div>

                {/* Card 2: Tenants Enterprise */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiEnterpriseTenants") || "Tenants Enterprise"}
                        </span>
                        <div className="text-2xl font-bold text-[#2563EB] mt-1 font-['Montserrat',sans-serif]">
                            {enterpriseCount}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#2563EB]">
                        <IconCrown size={24} stroke={1.5} />
                    </div>
                </div>

                {/* Card 3: Tenants Business / Pro */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiStandardTenants") || "Tenants Business / Pro"}
                        </span>
                        <div className="text-2xl font-bold text-[#0284C7] mt-1 font-['Montserrat',sans-serif]">
                            {standardCount}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0284C7]">
                        <IconPackages size={24} stroke={1.5} />
                    </div>
                </div>

                {/* Card 4: Provisionamientos Manuales */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiManualBypasses") || "Provisionamientos Manuales"}
                        </span>
                        <div className="text-2xl font-bold text-[#0054A6] mt-1 font-['Montserrat',sans-serif]">
                            {manualBypassCount}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0054A6]">
                        <IconShieldCheck size={24} stroke={1.5} />
                    </div>
                </div>
            </div>

            {/* ─── BANNER INSTRUCTIVO: Flujo de Cobro Paddle (Ancho 100%) ─────────────── */}
            <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                    <IconLink size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h3 className="text-xs font-bold text-[#0078D4] dark:text-blue-300 uppercase tracking-wider font-['Montserrat',sans-serif]">
                        {t("paddleBannerTitle")}
                    </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-slate-700 dark:text-slate-300">
                    <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40 space-y-1">
                        <span className="font-bold text-[#0078D4]">{t("step1Title")}</span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {t.rich("step1", { code: (c) => <code className="text-[#0078D4]">{c}</code>, b: (c) => <strong>{c}</strong> })}
                        </p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40 space-y-1">
                        <span className="font-bold text-[#0078D4]">{t("step2Title")}</span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {t.rich("step2", { code: (c) => <code className="text-[#0078D4]">{c}</code>, b: (c) => <strong>{c}</strong> })}
                        </p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40 space-y-1">
                        <span className="font-bold text-[#0078D4]">{t("step3Title")}</span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {t("step3")}
                        </p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40 space-y-1">
                        <span className="font-bold text-[#0078D4]">{t("step4Title")}</span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {t("step4")}
                        </p>
                    </div>
                </div>
            </div>

            {/* ─── SECCIÓN 1: Registrar Tenant Manual (Ancho 100%) ───────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <IconPlus size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("manualRegisterTitle") || "Registrar Tenant Manual"}
                    </h2>
                </div>

                <form onSubmit={handleCreateManualTenant} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("entraIdLabel") || "Entra ID del Tenant (Directorio / GUID)"}
                        </label>
                        <input
                            type="text"
                            value={newEntraId}
                            onChange={(e) => setNewEntraId(e.target.value)}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            required
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4] font-mono"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("companyNameLabel") || "Nombre Comercial de la Empresa"}
                        </label>
                        <input
                            type="text"
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                            placeholder="Empresa S.A."
                            required
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("initialTierLabel") || "Tier Inicial"}
                        </label>
                        <select
                            value={newInitialTier}
                            onChange={(e) => setNewInitialTier(e.target.value as SaaSPlanTier)}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="Professional">{t("tierProfessionalOption")}</option>
                            <option value="Business">Business (Hasta {SUBSCRIPTION_LIMITS.Business} suscripciones)</option>
                            <option value="Enterprise">Enterprise (Suscripciones ilimitadas)</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("trialDaysLabel") || "Período de Prueba"}
                        </label>
                        <select
                            value={newTrialDays}
                            onChange={(e) => setNewTrialDays(Number(e.target.value) as ManualTrialDays | 0)}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value={0}>{t("trialDaysNone") || "Sin trial (activo con contrato)"}</option>
                            {MANUAL_TRIAL_DAY_OPTIONS.map((d) => (
                                <option key={d} value={d}>
                                    {d} {t("trialDaysUnit") || "días de trial"}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <button
                            type="submit"
                            disabled={creatingManual || !newEntraId.trim() || !newOrgName.trim()}
                            className="w-full inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-6 py-2.5 rounded-lg font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                        >
                            {creatingManual ? (
                                <IconLoader2 size={15} className="animate-spin text-white" />
                            ) : (
                                <IconPlus size={15} stroke={1.5} className="text-white" />
                            )}
                            <span>{t("createTenantButton") || "Crear Tenant"}</span>
                        </button>
                    </div>
                </form>
            </div>

            {/* ─── SECCIÓN 2: Tabla Todos los Tenants (Estándar CMP) ────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Cabecera y Controles */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("tableTitle") || "Todos los Tenants"} ({filteredTenants.length})
                        </h2>
                        <button
                            onClick={loadTenants}
                            className="p-1 text-slate-400 hover:text-[#0078D4] rounded transition-colors"
                            title="Refrescar lista"
                        >
                            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        {/* Buscador */}
                        <div className="relative flex-1 sm:w-64">
                            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={t("searchPlaceholder") || "Buscar por nombre o GUID..."}
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        {/* MEJ-12 criterio 3: rango de fechas + exportación */}
                        <div className="flex items-center gap-1.5">
                            <select
                                value={lifecycleField}
                                onChange={(e) => { setLifecycleField(e.target.value as LifecycleDateField); setCurrentPage(1); }}
                                className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                title={t("filterDateFieldHint")}
                            >
                                <option value="activatedAtIso">Altas</option>
                                <option value="canceledAtIso">Bajas</option>
                            </select>
                            <input
                                type="date"
                                value={lifecycleFrom}
                                onChange={(e) => { setLifecycleFrom(e.target.value); setCurrentPage(1); }}
                                className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                title="Desde"
                            />
                            <span className="text-xs text-slate-400">a</span>
                            <input
                                type="date"
                                value={lifecycleTo}
                                onChange={(e) => { setLifecycleTo(e.target.value); setCurrentPage(1); }}
                                className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                title={t("filterToHint")}
                            />
                            {(lifecycleFrom || lifecycleTo) && (
                                <button
                                    type="button"
                                    onClick={() => { setLifecycleFrom(""); setLifecycleTo(""); setCurrentPage(1); }}
                                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700"
                                    title="Limpiar rango"
                                >
                                    Limpiar
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={handleExportCsv}
                            disabled={filteredTenants.length === 0}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-[#0078D4] hover:text-[#0078D4] disabled:opacity-50 transition-colors"
                            title={t("exportHint")}
                        >
                            Exportar CSV
                        </button>

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
                                            <span>Cargando tenants...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedTenants.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {t("noTenantsFound")}
                                    </td>
                                </tr>
                            ) : (
                                paginatedTenants.map((tItem) => (
                                    <tr key={tItem.tenantId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* Empresa */}
                                        {columns.find((c) => c.id === "company")?.visible && (
                                            <td className="px-4 py-3 text-slate-900 dark:text-slate-100 font-semibold">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#0078D4] flex items-center justify-center font-bold text-[11px] shrink-0 border border-blue-200 dark:border-blue-800">
                                                        {tItem.organizationName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="truncate max-w-[180px]" title={tItem.organizationName}>
                                                        {tItem.organizationName}
                                                    </span>
                                                </div>
                                            </td>
                                        )}

                                        {/* Tenant ID / GUID */}
                                        {columns.find((c) => c.id === "tenantId")?.visible && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                <span title={tItem.entraTenantId}>
                                                    {tItem.entraTenantId.length > 18
                                                        ? `${tItem.entraTenantId.slice(0, 18)}...`
                                                        : tItem.entraTenantId}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyText(tItem.entraTenantId, tItem.tenantId)}
                                                    className="text-slate-400 hover:text-[#0078D4] inline ml-1.5"
                                                    title="Copiar GUID"
                                                >
                                                    {copiedGuid === tItem.tenantId ? (
                                                        <IconCheck size={13} className="text-emerald-600" />
                                                    ) : (
                                                        <IconCopy size={13} />
                                                    )}
                                                </button>
                                            </td>
                                        )}

                                        {/* Suscripción (Select en línea) */}
                                        {columns.find((c) => c.id === "subscription")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <select
                                                    value={tItem.subscriptionStatus}
                                                    onChange={(e) =>
                                                        handleUpdateTier(
                                                            tItem.tenantId,
                                                            tItem.planTier,
                                                            e.target.value as TenantSubscriptionStatus
                                                        )
                                                    }
                                                    className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-[#0078D4]"
                                                >
                                                    <option value="ACTIVE">ACTIVE</option>
                                                    <option value="TRIAL">TRIAL</option>
                                                    <option value="PAST_DUE">PAST_DUE</option>
                                                    <option value="CANCELED">CANCELED</option>
                                                </select>
                                                {tItem.subscriptionStatus === "TRIAL" && tItem.trialEndsAtIso && (
                                                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                                                        {t("trialEndsAt") || "Vence"}:{" "}
                                                        {new Date(tItem.trialEndsAtIso).toLocaleDateString()}
                                                    </div>
                                                )}
                                            </td>
                                        )}

                                        {/* MEJ-12: fechas del ciclo de vida. Las de los tenants
                                            anteriores a la migración son el `created_at` del
                                            registro, no el alta efectiva — por eso el título lo
                                            aclara al pasar el mouse. */}
                                        {columns.find((c) => c.id === "activatedAt")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300"
                                                title={tItem.activatedAtIso ? "Alta efectiva. Para tenants previos a MEJ-12 es la fecha de creación del registro." : ""}>
                                                {tItem.activatedAtIso ? new Date(tItem.activatedAtIso).toLocaleDateString() : "—"}
                                            </td>
                                        )}
                                        {columns.find((c) => c.id === "canceledAt")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                                                {tItem.canceledAtIso ? new Date(tItem.canceledAtIso).toLocaleDateString() : "—"}
                                            </td>
                                        )}
                                        {columns.find((c) => c.id === "cancellationReason")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                                                {tItem.cancellationReason ? (CANCELLATION_REASON_LABEL[tItem.cancellationReason] || tItem.cancellationReason) : "—"}
                                            </td>
                                        )}

                                        {/* Tier Actual (Select en línea: 3 Tiers oficiales) */}
                                        {columns.find((c) => c.id === "tier")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <select
                                                    value={tItem.planTier}
                                                    onChange={(e) =>
                                                        handleUpdateTier(
                                                            tItem.tenantId,
                                                            e.target.value as SaaSPlanTier,
                                                            tItem.subscriptionStatus
                                                        )
                                                    }
                                                    className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0078D4] dark:text-blue-400 focus:ring-1 focus:ring-[#0078D4]"
                                                >
                                                    <option value="Professional">Professional</option>
                                                    <option value="Business">Business</option>
                                                    <option value="Enterprise">Enterprise</option>
                                                </select>
                                            </td>
                                        )}

                                        {/* Vendedor (Input editable) */}
                                        {columns.find((c) => c.id === "salesRep")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <input
                                                    type="text"
                                                    value={tItem.salesRepName}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setTenants((prev) =>
                                                            prev.map((t) =>
                                                                t.tenantId === tItem.tenantId ? { ...t, salesRepName: val } : t
                                                            )
                                                        );
                                                    }}
                                                    placeholder="Vendedor / Partner"
                                                    className="w-36 px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                                                />
                                            </td>
                                        )}

                                        {/* Comisión % (Input editable) */}
                                        {columns.find((c) => c.id === "commission")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        step="0.5"
                                                        min="0"
                                                        max="100"
                                                        value={tItem.salesCommissionPercent}
                                                        onChange={(e) => {
                                                            const val = Number(e.target.value);
                                                            setTenants((prev) =>
                                                                prev.map((t) =>
                                                                    t.tenantId === tItem.tenantId
                                                                        ? { ...t, salesCommissionPercent: val }
                                                                        : t
                                                                )
                                                            );
                                                        }}
                                                        className="w-16 px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-right"
                                                    />
                                                    <span className="text-slate-500 font-semibold text-xs">%</span>
                                                </div>
                                            </td>
                                        )}

                                        {/* Botón Guardar Comercial */}
                                        {columns.find((c) => c.id === "saveDeal")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveCommercialDeal(tItem)}
                                                    disabled={savingTenantId === tItem.tenantId}
                                                    className="inline-flex items-center gap-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                                >
                                                    {savingTenantId === tItem.tenantId ? (
                                                        <IconLoader2 size={13} className="animate-spin text-[#0078D4]" />
                                                    ) : (
                                                        <IconDeviceFloppy size={13} className="text-slate-500" />
                                                    )}
                                                    <span>Guardar</span>
                                                </button>
                                            </td>
                                        )}

                                        {/* Cobrar vía Paddle (Input + Botón en Azul Corporativo) */}
                                        {columns.find((c) => c.id === "paddleCheckout")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5">
                                                    <input
                                                        type="text"
                                                        value={priceIds[tItem.tenantId] || ""}
                                                        onChange={(e) =>
                                                            setPriceIds({ ...priceIds, [tItem.tenantId]: e.target.value })
                                                        }
                                                        placeholder="pri_..."
                                                        className="w-28 px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGeneratePaddleLink(tItem)}
                                                        disabled={generatingLinkId === tItem.tenantId}
                                                        className="inline-flex items-center gap-1 bg-[#0078D4] hover:bg-[#0060AA] text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all whitespace-nowrap disabled:opacity-50"
                                                    >
                                                        {generatingLinkId === tItem.tenantId ? (
                                                            <IconLoader2 size={13} className="animate-spin text-white" />
                                                        ) : (
                                                            <IconSend size={13} className="text-white" />
                                                        )}
                                                        <span>Generar link</span>
                                                    </button>
                                                </div>
                                            </td>
                                        )}

                                        {/* Botón Impersonar Tenant */}
                                        {columns.find((c) => c.id === "impersonate")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartImpersonation(tItem)}
                                                    disabled={impersonatingId === tItem.tenantId}
                                                    className="inline-flex items-center gap-1.5 border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-[#0078D4] dark:text-blue-300 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-all disabled:opacity-50"
                                                    title={`Ingresar a ${tItem.organizationName || tItem.tenantId} como Administrador`}
                                                >
                                                    {impersonatingId === tItem.tenantId ? (
                                                        <IconLoader2 size={13} className="animate-spin text-[#0078D4]" />
                                                    ) : (
                                                        <IconShieldLock size={13} className="text-[#0078D4]" />
                                                    )}
                                                    <span>Impersonar</span>
                                                </button>
                                            </td>
                                        )}

                                        {/* Botón Eliminar Tenant (Superadmin Only) */}
                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <DeleteTenantModal
                                                    tenantId={tItem.tenantId}
                                                    tenantName={tItem.organizationName || tItem.tenantId}
                                                    onDeleted={loadTenants}
                                                    trigger={
                                                        <button
                                                            type="button"
                                                            className="inline-flex items-center gap-1 border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-all"
                                                            title={`Eliminar tenant ${tItem.organizationName || tItem.tenantId}`}
                                                        >
                                                            <IconTrash size={13} className="text-rose-600 dark:text-rose-400" />
                                                            <span>Eliminar</span>
                                                        </button>
                                                    }
                                                />
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
                        <span>de {filteredTenants.length} registros</span>
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
                            {t("pageOf", { page: currentPage, total: totalPages })}
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

            {/* ─── MODAL: Enlace de Checkout Paddle Generado (z-[100]) ──────────────── */}
            {generatedLinkData?.modalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("modalTitle") || "Checkout Link Listo para Enviar"}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t.rich("linkBoundTo", { org: () => <strong>{generatedLinkData.orgName}</strong> })}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGeneratedLinkData(null)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("checkoutUrl")}
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    readOnly
                                    value={generatedLinkData.checkoutUrl}
                                    className="w-full pr-10 pl-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-slate-800 dark:text-slate-200 select-all"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setGeneratedLinkData(null)}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t("close") || "Cerrar"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(generatedLinkData.checkoutUrl);
                                    setGeneratedLinkData({ ...generatedLinkData, copied: true });
                                }}
                                className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm"
                            >
                                {generatedLinkData.copied ? (
                                    <>
                                        <IconCheck size={14} />
                                        <span>{t("copied")}</span>
                                    </>
                                ) : (
                                    <>
                                        <IconCopy size={14} />
                                        <span>{t("copyLink") || "Copiar Enlace de Pago"}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export { TenantManagementPanel };
