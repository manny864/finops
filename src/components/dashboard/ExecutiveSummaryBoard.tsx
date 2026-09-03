"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconReceipt2,
  IconTrendingUp,
  IconTrash,
  IconSparkles,
  IconLeaf,
  IconCloud,
  IconRotateClockwise,
  IconInfoCircle,
  IconEye,
  IconEyeOff,
  IconRotate,
  IconLayoutGrid,
  IconX,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import MyPinnedWidgets from "@/components/dashboard/MyPinnedWidgets";
import WhiteboardBudgetWidget from "@/components/dashboard/WhiteboardBudgetWidget";
import WhiteboardForecastWidget from "@/components/dashboard/WhiteboardForecastWidget";
import WhiteboardTopServicesWidget from "@/components/dashboard/WhiteboardTopServicesWidget";
import WhiteboardGovernanceWidget from "@/components/dashboard/WhiteboardGovernanceWidget";
import WhiteboardAdvisorWidget from "@/components/dashboard/WhiteboardAdvisorWidget";
import WhiteboardQuickWinsWidget from "@/components/dashboard/WhiteboardQuickWinsWidget";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getCookie, setCookie } from "@/lib/clientCookie";

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_STORAGE_KEY = "finops_whiteboard_layout_v2";
const HIDDEN_CARDS_STORAGE_KEY = "finops_whiteboard_hidden_cards_v2";
const CARDS_PANEL_VISIBLE_STORAGE_KEY = "finops_whiteboard_cards_panel_visible_v2";
const GRID_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

const LG_ITEMS = [
  // Fila 1: Control Financiero & Previsibilidad (3 columnas)
  { i: "wbForecast", x: 0, y: 0, w: 4, h: 6 },
  { i: "wbTopServices", x: 4, y: 0, w: 4, h: 6 },
  { i: "wbBudgets", x: 8, y: 0, w: 4, h: 6 },
  // Fila 2: Salud Operativa, Gobernanza y Seguridad (2 paneles)
  { i: "wbGovernance", x: 0, y: 6, w: 6, h: 6 },
  { i: "wbAdvisor", x: 6, y: 6, w: 6, h: 6 },
  // Fila 3: Top Quick Wins (ancho completo)
  { i: "wbQuickWins", x: 0, y: 12, w: 12, h: 5 },
];

/**
 * Los ids de las tarjetas del tablero. El texto sale de `messages/` bajo
 * `WhiteBoard.card.<id>`: esto es un Record a nivel de módulo y no puede llamar
 * al hook de traducción, así que sólo guarda la lista.
 */
const CARD_IDS = [
  "wbForecast",
  "wbTopServices",
  "wbBudgets",
  "wbGovernance",
  "wbAdvisor",
  "wbQuickWins",
] as const;

function deriveLayoutForCols(baseItems: typeof LG_ITEMS, cols: number, baseCols = 12) {
  if (cols <= 4) {
    let y = 0;
    return baseItems.map((item) => {
      const laidOut = { ...item, x: 0, y, w: cols, h: item.h };
      y += item.h;
      return laidOut;
    });
  }
  const scale = cols / baseCols;
  return baseItems.map((item) => ({
    ...item,
    x: Math.max(0, Math.min(cols - 1, Math.round(item.x * scale))),
    w: Math.max(1, Math.min(cols, Math.round(item.w * scale))),
  }));
}

const DEFAULT_LAYOUT = {
  lg: LG_ITEMS,
  md: deriveLayoutForCols(LG_ITEMS, GRID_COLS.md),
  sm: deriveLayoutForCols(LG_ITEMS, GRID_COLS.sm),
  xs: deriveLayoutForCols(LG_ITEMS, GRID_COLS.xs),
  xxs: deriveLayoutForCols(LG_ITEMS, GRID_COLS.xxs),
};

function collides(a: any, b: any): boolean {
  if (a.i === b.i) return false;
  if (a.x + a.w <= b.x) return false;
  if (b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y) return false;
  if (b.y + b.h <= a.y) return false;
  return true;
}

function normalizeBreakpointLayout(items: any[], cols: number): any[] {
  const placed: any[] = [];
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const raw of ordered) {
    const item = {
      ...raw,
      w: Math.max(1, Math.min(cols, Number(raw.w) || 1)),
      h: Math.max(1, Number(raw.h) || 1),
      x: Math.max(0, Number(raw.x) || 0),
      y: Math.max(0, Number(raw.y) || 0),
    };

    if (item.x + item.w > cols) item.x = Math.max(0, cols - item.w);

    while (placed.some((p) => collides(item, p))) {
      item.y += 1;
    }
    placed.push(item);
  }

  return placed;
}

function normalizeLayouts(allLayouts: any): any {
  if (!allLayouts) return allLayouts;
  const next = { ...allLayouts };
  (Object.keys(GRID_COLS) as Array<keyof typeof GRID_COLS>).forEach((bp) => {
    const list = Array.isArray(next[bp]) ? next[bp] : [];
    next[bp] = normalizeBreakpointLayout(list, GRID_COLS[bp]);
  });
  return next;
}

function Card({
  title,
  onClose,
  className = "",
  children,
}: {
  title?: string;
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`drag-handle cursor-move bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-4 flex flex-col h-full overflow-hidden relative group hover:border-[#0078D4]/40 transition-colors ${className}`}
    >
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
          title="Cerrar tarjeta de la pizarra"
        >
          <IconX className="w-4 h-4 stroke-[2.5]" />
        </button>
      )}
      {title && (
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#1B2A41] dark:text-slate-300 mb-3 pr-6 truncate">
          {title}
        </h3>
      )}
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  badge,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  badge?: { text: string; positive: boolean };
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-4 flex items-start gap-3.5 hover:border-[#0078D4]/30 transition-all">
      <div className="shrink-0 mt-0.5 bg-transparent">
        <Icon className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate mb-0.5">
          {label}
        </p>
        <div className="flex items-baseline gap-2">
          <p className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100 truncate">
            {value}
          </p>
          {badge && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                badge.positive
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400"
              }`}
            >
              {badge.text}
            </span>
          )}
        </div>
        {sub && <p className="text-[11px] text-slate-400 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function ExecutiveSummaryBoard() {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { format } = useCurrency();

  const [hiddenCards, setHiddenCards] = useState<string[]>([]);
  const [cardsPanelVisible, setCardsPanelVisible] = useState(false);
  const [timeRange, setTimeRange] = useState("MTD");

  const fetcher = async (url: string) => {
    const headers: Record<string, string> = {};
    if (accounts.length > 0) {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "Error al cargar datos");
    }
    return res.json();
  };

  const isDemo = Boolean(selectedTenant?.id && isMockTenant(selectedTenant.id));
  const canFetch =
    !!selectedTenant &&
    selectedTenant.id !== "default" &&
    (accounts.length > 0 || isDemo);

  const { data, error, isLoading, mutate } = useSWR(
    canFetch
      ? `/api/overview/whiteboard?tenantId=${selectedTenant.id}&locale=${locale}${isDemo ? "&mock=true" : ""}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const summarySub = "All";
  const { data: summaryData, isLoading: summaryLoading } = useSWR(
    canFetch
      ? `/api/dashboard/summary?tenantId=${selectedTenant!.id}&subscriptionId=${summarySub}${isDemo ? "&mock=true" : ""}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [layouts, setLayouts] = useState<any>(null);

  useEffect(() => {
    const raw = getCookie(LAYOUT_STORAGE_KEY) || localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        Object.keys(DEFAULT_LAYOUT).forEach((bp: string) => {
          if (!parsed[bp]) {
            parsed[bp] = DEFAULT_LAYOUT[bp as keyof typeof DEFAULT_LAYOUT];
            return;
          }
          const existing = new Set((parsed[bp] || []).map((l: any) => l.i));
          LG_ITEMS.forEach((item) => {
            if (!existing.has(item.i)) parsed[bp].push(item);
          });
        });
        setLayouts(normalizeLayouts(parsed));
      } catch {
        setLayouts(DEFAULT_LAYOUT);
      }
    } else {
      setLayouts(DEFAULT_LAYOUT);
    }

    const hiddenRaw =
      getCookie(HIDDEN_CARDS_STORAGE_KEY) || localStorage.getItem(HIDDEN_CARDS_STORAGE_KEY);
    if (hiddenRaw) {
      try {
        const parsedHidden = JSON.parse(hiddenRaw);
        if (Array.isArray(parsedHidden)) setHiddenCards(parsedHidden);
      } catch {}
    }

    const panelVisibleRaw =
      getCookie(CARDS_PANEL_VISIBLE_STORAGE_KEY) ||
      localStorage.getItem(CARDS_PANEL_VISIBLE_STORAGE_KEY);
    if (panelVisibleRaw) {
      try {
        const parsedVisible = JSON.parse(panelVisibleRaw);
        if (typeof parsedVisible === "boolean") setCardsPanelVisible(parsedVisible);
      } catch {}
    }
  }, []);

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenLayoutSnapshotRef = useRef<Record<string, Record<string, any>>>({});

  const persistLayouts = useCallback((allLayouts: any) => {
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      const serialized = JSON.stringify(allLayouts);
      setCookie(LAYOUT_STORAGE_KEY, serialized);
      localStorage.setItem(LAYOUT_STORAGE_KEY, serialized);
    }, 400);
  }, []);

  const snapshotCardLayout = useCallback(
    (cardId: string) => {
      if (!layouts) return;
      const snapshot: Record<string, any> = {};
      Object.keys(DEFAULT_LAYOUT).forEach((bp) => {
        const current = (layouts[bp] || []).find((l: any) => l.i === cardId);
        const fallback = (
          DEFAULT_LAYOUT[bp as keyof typeof DEFAULT_LAYOUT] as any[]
        ).find((l: any) => l.i === cardId);
        if (current || fallback) snapshot[bp] = { ...(current || fallback) };
      });
      hiddenLayoutSnapshotRef.current[cardId] = snapshot;
    },
    [layouts]
  );

  const restoreCardsLayout = useCallback(
    (cardIds: string[]) => {
      setLayouts((prev: any) => {
        if (!prev || cardIds.length === 0) return prev;
        let changed = false;
        const nextLayouts = { ...prev };

        Object.keys(DEFAULT_LAYOUT).forEach((bp) => {
          const bpItems = Array.isArray(nextLayouts[bp]) ? [...nextLayouts[bp]] : [];
          cardIds.forEach((cardId) => {
            const exists = bpItems.some((l: any) => l.i === cardId);
            if (exists) return;

            const snapshot = hiddenLayoutSnapshotRef.current[cardId]?.[bp];
            const fallback = (
              DEFAULT_LAYOUT[bp as keyof typeof DEFAULT_LAYOUT] as any[]
            ).find((l: any) => l.i === cardId);
            const toInsert = snapshot || fallback;
            if (toInsert) {
              bpItems.push({ ...toInsert });
              changed = true;
            }
          });
          nextLayouts[bp] = bpItems;
        });

        if (!changed) return prev;
        const normalized = normalizeLayouts(nextLayouts);
        persistLayouts(normalized);
        return normalized;
      });
    },
    [persistLayouts]
  );

  const onLayoutChange = (_layout: any, allLayouts: any) => {
    const normalized = normalizeLayouts(allLayouts);
    setLayouts(normalized);
    persistLayouts(normalized);
  };

  const handleHideCard = (cardId: string) => {
    snapshotCardLayout(cardId);
    setHiddenCards((prev) => {
      if (prev.includes(cardId)) return prev;
      const updated = [...prev, cardId];
      const serialized = JSON.stringify(updated);
      setCookie(HIDDEN_CARDS_STORAGE_KEY, serialized);
      localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, serialized);
      return updated;
    });
  };

  const handleRestoreCard = (cardId: string) => {
    restoreCardsLayout([cardId]);
    setHiddenCards((prev) => {
      const updated = prev.filter((id) => id !== cardId);
      const serialized = JSON.stringify(updated);
      setCookie(HIDDEN_CARDS_STORAGE_KEY, serialized);
      localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, serialized);
      return updated;
    });
  };

  const handleRestoreAllCards = () => {
    setHiddenCards((prev) => {
      restoreCardsLayout(prev);
      setCookie(HIDDEN_CARDS_STORAGE_KEY, JSON.stringify([]));
      localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, JSON.stringify([]));
      return [];
    });
  };

  const toggleCardsPanel = () => {
    setCardsPanelVisible((prev) => {
      const next = !prev;
      const serialized = JSON.stringify(next);
      setCookie(CARDS_PANEL_VISIBLE_STORAGE_KEY, serialized);
      localStorage.setItem(CARDS_PANEL_VISIBLE_STORAGE_KEY, serialized);
      return next;
    });
  };

  // Se calcula en un efecto y no durante el render: Date.now() en render
  // produce hydration mismatch (servidor y cliente devuelven valores distintos).
  // Ademas el intervalo mantiene el "hace N min" vivo en lugar de congelarlo en
  // el valor del primer render.
  const [syncMinutesAgo, setSyncMinutesAgo] = useState<number | null>(null);
  useEffect(() => {
    const cachedAt = data?.cached_at;
    if (!cachedAt) {
      setSyncMinutesAgo(null);
      return;
    }
    const tick = () =>
      setSyncMinutesAgo(
        Math.max(0, Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000))
      );
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [data?.cached_at]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-8 h-8 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Cargando Pizarra Ejecutiva...
        </p>
      </div>
    );
  }

  if (error) {
    const requiredTier = parseTierRequiredError(error.message);
    if (requiredTier) {
      return (
        <TierLockedNotice
          requiredTier={requiredTier}
          currentTier={(selectedTenant as any)?.tier}
          featureName="White Board Ejecutivo"
        />
      );
    }
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-3">
        <IconInfoCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-sm">Error al cargar la pizarra ejecutiva</h3>
          <p className="text-xs mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data || !layouts) return null;

  const isCardVisible = (cardId: string) => !hiddenCards.includes(cardId);

  // Reconciled values from unified data source
  const costMtdUSD = Number(data?.summary?.costMtdUSD ?? summaryData?.actualCost ?? 0);
  const forecastEomUSD = Number(data?.summary?.forecastEomUSD ?? summaryData?.projectedCost ?? 0);
  // `||` y no `??`: el whiteboard SIEMPRE define estos campos (0 cuando su
  // enriquecimiento server-side falla), así que con `??` el 0 ganaba y anulaba
  // el valor real que este mismo componente ya tiene de /api/dashboard/summary.
  const zombieCount = Number(data?.summary?.zombieResourcesCount || data?.summary?.zombieCount || summaryData?.zombieCount || 0);
  const zombieWasteUSD = Number(data?.summary?.zombieMonthlyWasteUSD ?? data?.summary?.zombieSavingsUSD ?? (zombieCount > 0 ? zombieCount * 30 : 0));
  
  // Potential Savings Sanity Check: Must be monthly and <= projectedCost
  let rawSavings = Number(data?.summary?.potentialSavingsUSD ?? summaryData?.totalSavings ?? 0);
  if (forecastEomUSD > 0 && rawSavings > forecastEomUSD) {
    rawSavings = rawSavings / 12;
  }
  const potentialSavingsUSD = forecastEomUSD > 0 ? Math.min(rawSavings, forecastEomUSD * 0.45) : rawSavings;
  const carbonKg = Number(data?.summary?.carbonKgCO2e || summaryData?.environmentalImpact || 0);
  const momVariation = data?.summary?.momVariationPct ?? summaryData?.momVariation ?? 0;


  return (
    <div className="w-full space-y-5 relative">
      {/* 1. Header Minimalista y Barra de Estado Única */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs text-xs flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
            <IconCloud className="w-3.5 h-3.5" stroke={2} />
            {data.mock ? "☁️ Azure Demo" : "☁️ Azure Conectado"}
          </span>

          <span className="text-slate-500 dark:text-slate-400 text-[11px]">
            {t("lastSync")}:{" "}
            <strong className="text-slate-700 dark:text-slate-300">
              {syncMinutesAgo != null
                ? syncMinutesAgo === 0
                  ? "Hace un momento"
                  : `Hace ${syncMinutesAgo} min`
                : "Reciente"}
            </strong>
          </span>

          <div className="flex items-center gap-1">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="text-[11px] font-medium border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-[#0078D4] focus:outline-hidden cursor-pointer"
            >
              <option value="MTD">Mes actual (MTD)</option>
              <option value="30D">{t("last30")}</option>
              <option value="90D">{t("last90")}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleCardsPanel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#0078D4] hover:text-[#0078D4] transition-all shadow-xs cursor-pointer"
          >
            <IconLayoutGrid className="w-3.5 h-3.5 text-[#0078D4]" />
            Personalizar {hiddenCards.length > 0 && `(${hiddenCards.length} ocultas)`}
          </button>

          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all shadow-xs cursor-pointer"
          >
            <IconRotateClockwise className="w-3.5 h-3.5" stroke={2} />
            {t("refresh")}
          </button>
        </div>
      </div>

      {data.mock && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs text-amber-800 dark:text-amber-300">
          <IconInfoCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" stroke={1.5} />
          <span>{t("demoNotice")}</span>
        </div>
      )}

      <TelemetryDisclaimerBanner compact />

      {/* 2. Top 5 KPI Cards Superiores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3.5">
        <KpiCard
          icon={IconReceipt2}
          label={t("kpiCurrentCost")}
          value={summaryLoading ? "…" : format(costMtdUSD)}
          sub={t("kpiCurrentCostSub")}
          badge={
            momVariation !== 0
              ? {
                  text: `${momVariation > 0 ? "+" : ""}${momVariation.toFixed(1)}% MoM`,
                  positive: momVariation <= 0,
                }
              : undefined
          }
        />
        <KpiCard
          icon={IconTrendingUp}
          label={t("kpiProjectedCost")}
          value={summaryLoading ? "…" : format(forecastEomUSD)}
          sub={t("kpiProjectedCostSub")}
        />
        <KpiCard
          icon={IconTrash}
          label={t("kpiZombies")}
          value={summaryLoading ? "…" : String(zombieCount)}
          sub={t("kpiZombiesSub", { amount: format(zombieWasteUSD) })}
        />
        <KpiCard
          icon={IconSparkles}
          label={t("kpiSavings")}
          value={summaryLoading ? "…" : format(potentialSavingsUSD)}
          sub={t("kpiSavingsSub")}
        />
        <KpiCard
          icon={IconLeaf}
          label={t("kpiCarbon")}
          value={summaryLoading ? "…" : `${Number(carbonKg).toFixed(1)} kg`}
          sub={t("kpiCarbonSub")}
        />
      </div>

      {/* Mi Dashboard (Se colapsa automáticamente a 0px si no hay widgets pineados) */}
      <MyPinnedWidgets />

      {/* 3. Grid de Widgets de la Pizarra Ejecutiva (Sin Resizing de Tarjetas) */}
      <div className="flex flex-col 2xl:flex-row gap-6 items-start">
        <div className="w-full min-w-0">
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={GRID_COLS}
            rowHeight={70}
            onLayoutChange={onLayoutChange}
            draggableHandle=".drag-handle"
            allowOverlap={false}
            compactType="vertical"
            isResizable={false}
            resizeHandles={[]}
          >
            {/* ===== FILA 1: Control Financiero & Previsibilidad ===== */}

            {isCardVisible("wbForecast") && (
              <div key="wbForecast">
                <Card title={t("wb_forecast_title")} onClose={() => handleHideCard("wbForecast")}>
                  <WhiteboardForecastWidget
                    costTrend={data?.costTrend || []}
                    forecastEomUSD={forecastEomUSD}
                  />
                </Card>
              </div>
            )}

            {isCardVisible("wbTopServices") && (
              <div key="wbTopServices">
                <Card title={t("wb_top_services_title")} onClose={() => handleHideCard("wbTopServices")}>
                  <WhiteboardTopServicesWidget topServices={data?.topServices || []} />
                </Card>
              </div>
            )}

            {isCardVisible("wbBudgets") && (
              <div key="wbBudgets">
                <Card title={t("wb_budgets_title")} onClose={() => handleHideCard("wbBudgets")}>
                  <WhiteboardBudgetWidget budgets={data?.budgets || []} />
                </Card>
              </div>
            )}

            {/* ===== FILA 2: Salud Operativa, Gobernanza y Seguridad ===== */}

            {isCardVisible("wbGovernance") && (
              <div key="wbGovernance">
                <Card title={t("wb_governance_title")} onClose={() => handleHideCard("wbGovernance")}>
                  <WhiteboardGovernanceWidget
                    tagCoveragePct={data?.tagCoveragePct ?? 100}
                    untaggedResourcesCount={data?.untaggedResourcesCount ?? 0}
                    unallocatedCostUSD={data?.unallocatedCostUSD ?? 0}
                  />
                </Card>
              </div>
            )}

            {isCardVisible("wbAdvisor") && (
              <div key="wbAdvisor">
                <Card title={t("wb_advisor_title")} onClose={() => handleHideCard("wbAdvisor")}>
                  <WhiteboardAdvisorWidget
                    advisorPillars={
                      data?.advisorPillars || { cost: 0, security: 0, reliability: 0, performance: 0 }
                    }
                    securityActions={data?.securityActions || []}
                    advisorScore={Number(data?.advisorScore || 0)}
                  />
                </Card>
              </div>
            )}

            {/* ===== FILA 3: Top Quick Wins ===== */}

            {isCardVisible("wbQuickWins") && (
              <div key="wbQuickWins">
                <Card title={t("wb_quick_wins_title")} onClose={() => handleHideCard("wbQuickWins")}>
                  <WhiteboardQuickWinsWidget quickWins={data?.quickWins || []} />
                </Card>
              </div>
            )}
          </ResponsiveGridLayout>
        </div>

        {/* Panel Lateral de Personalización */}
        {cardsPanelVisible && (
          <aside className="w-full 2xl:w-[320px] 2xl:sticky 2xl:top-24 shrink-0 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <IconLayoutGrid className="w-4 h-4 text-[#0078D4]" />
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                        Personalizar Pizarra
                      </h3>
                      <p className="text-[10px] text-slate-500">{t("customizeHint")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleCardsPanel}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <IconX className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-2.5 max-h-[calc(100vh-240px)] overflow-y-auto">
                {hiddenCards.length > 0 && (
                  <div className="mb-3 flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    <span className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                      {hiddenCards.length}{" "}
                      {hiddenCards.length === 1 ? "tarjeta oculta" : "tarjetas ocultas"}
                    </span>
                    <button
                      type="button"
                      onClick={handleRestoreAllCards}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      <IconRotate className="w-3 h-3" /> Restaurar
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {LG_ITEMS.map((item) => {
                    const conocida = (CARD_IDS as readonly string[]).includes(item.i);
                    const meta = conocida
                      ? { label: t(`card.${item.i}.label`), description: t(`card.${item.i}.desc`) }
                      : { label: item.i, description: "" };
                    const isHidden = hiddenCards.includes(item.i);

                    return (
                      <div
                        key={item.i}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                          isHidden
                            ? "bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 opacity-60"
                            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs"
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                            {meta.label}
                          </p>
                          {meta.description && (
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {meta.description}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            isHidden ? handleRestoreCard(item.i) : handleHideCard(item.i)
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition-colors inline-flex items-center gap-1 cursor-pointer ${
                            isHidden
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                              : "bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {isHidden ? (
                            <>
                              <IconEye className="w-3 h-3" /> Mostrar
                            </>
                          ) : (
                            <>
                              <IconEyeOff className="w-3 h-3" /> Ocultar
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
