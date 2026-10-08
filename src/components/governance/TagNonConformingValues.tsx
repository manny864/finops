"use client";

import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IconArrowDownRight, IconLoader2, IconSparkles, IconTagOff, IconX } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import Pagination, { usePagination } from "@/components/Pagination";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { errorMessage } from "@/lib/apiErrors";
import { canRemediateTags, getTagRemediationTier } from "@/lib/tierLogic";
import { tagValueKey } from "@/lib/tagValueNormalizer";
import {
  findMissingTag,
  groupNonConformingValues,
  tagVocabulary,
  type MissingTagCandidate,
  type NonConformingValueGroup,
} from "@/lib/tagNonConformities";
import type { TagNormalizationKpis } from "@/services/tagNormalization.service";
import type {
  ResourceGroupTagAuditItem,
  ResourceTagAuditItem,
  TagAiMode,
  TagAiSuggestionResult,
  TagAiUnavailableReason,
  TagPolicyRule,
} from "@/types/azureTagGovernance.types";

export interface AppliedTagChange {
  id: string;
  tags: Record<string, string>;
}

interface Props {
  tenantId: string;
  token: string;
  isDemo: boolean;
  policies: readonly TagPolicyRule[];
  resources: readonly ResourceTagAuditItem[];
  resourceGroups: readonly ResourceGroupTagAuditItem[];
  /** Lo que quedó aplicado en Azure, para actualizar las tablas sin esperar a Resource Graph. */
  onTagsApplied: (changes: AppliedTagChange[]) => void;
}

interface Suggestion {
  value: string;
  source: "rule" | "ai";
  method: string;
  confidence: number;
}

interface AiState {
  loading?: boolean;
  reason?: TagAiUnavailableReason;
  /** normalize: por valor no conforme; fill: por id de recurso en minúsculas. value null = la IA no supo. */
  picks?: Record<string, { value: string | null; confidence: number }>;
}

interface FillRow {
  resource: ResourceTagAuditItem;
  suggestion: string | null;
  confidence: number;
  value: string;
  approved: boolean;
}

type Pending =
  | { kind: "normalize"; group: NonConformingValueGroup; value: string; suggestion: Suggestion | null }
  | { kind: "inherit"; policy: TagPolicyRule; candidates: MissingTagCandidate[] }
  | { kind: "fill"; policy: TagPolicyRule; rows: FillRow[] };

const BULK_LIMIT = 100; // máximo de /api/tags/apply-bulk
const INHERIT_LIMIT = 200; // máximo de /api/governance/tags/apply-inheritance
const PREVIEW_NAMES = 8;

const groupKey = (g: { tagName: string; value: string }) => `${g.tagName}\u0000${g.value}`;
const aiKey = (mode: TagAiMode, tagName: string) => `${mode}:${tagName.toLowerCase()}`;
const pct = (n: number) => Math.round(n * 100);

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

const btnPrimary =
  "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#0054A6] text-white hover:bg-[#004589] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnOutline =
  "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const selectCls =
  "w-full max-w-[180px] px-2 py-1 text-[11px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]";

/**
 * Valores no conformes de Tag Governance (propuesta de IA, Fase 2): valores
 * fuera de los permitidos, con el canónico que propone el normalizador o, para
 * el residuo, la IA; y CostCenter/Department faltantes, primero heredados del
 * grupo de recursos y después propuestos por la IA. Nada se aplica sin
 * confirmar: corregir usa /api/tags/apply-bulk y heredar apply-inheritance,
 * con los mismos permisos (Admin/Owner, plan Business) que el resto de la pantalla.
 */
export default function TagNonConformingValues({
  tenantId,
  token,
  isDemo,
  policies,
  resources,
  resourceGroups,
  onTagsApplied,
}: Props) {
  const t = useTranslations("TagNormalization");
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const canApply = canRemediateTags(selectedTenant?.tier);
  const applyTitle = canApply ? undefined : t("applyTierTip", { tier: getTagRemediationTier() });

  const headers = useMemo<Record<string, string>>(
    () => ({ "Content-Type": "application/json", ...(token && !isDemo ? { Authorization: `Bearer ${token}` } : {}) }),
    [token, isDemo],
  );

  const { data: kpis, mutate: refreshKpis } = useSWR<TagNormalizationKpis>(
    isDemo || token ? [`/api/governance/tags/normalization?tenantId=${encodeURIComponent(tenantId)}`, token] : null,
    async ([url, tok]: [string, string]) => {
      const res = await fetch(url, { headers: tok && !isDemo ? { Authorization: `Bearer ${tok}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  // Descartar oculta el grupo hasta el próximo escaneo.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [ai, setAi] = useState<Record<string, AiState>>({});
  const [fillRows, setFillRows] = useState<Record<string, FillRow[]>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [saveAlias, setSaveAlias] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(
    () => groupNonConformingValues(resources, resourceGroups).filter((g) => !dismissed.has(groupKey(g))),
    [resources, resourceGroups, dismissed],
  );
  const pag = usePagination(groups, 10);

  const missing = useMemo(
    () =>
      policies
        .filter((p) => p.isRequired && !p.allowedValues?.length)
        .map((policy) => ({ policy, candidates: findMissingTag(resources, resourceGroups, policy.tagName) }))
        .filter((m) => m.candidates.length > 0),
    [policies, resources, resourceGroups],
  );

  const allowedOf = (tagName: string) =>
    policies.find((p) => p.tagName.toLowerCase() === tagName.toLowerCase())?.allowedValues ?? [];

  const suggestionOf = (g: NonConformingValueGroup): Suggestion | null => {
    if (g.suggestion.normalized && g.suggestion.method) {
      return { value: g.suggestion.normalized, source: "rule", method: g.suggestion.method, confidence: g.suggestion.confidence };
    }
    const pick = ai[aiKey("normalize", g.tagName)]?.picks?.[g.value];
    return pick?.value ? { value: pick.value, source: "ai", method: "ai", confidence: pick.confidence } : null;
  };

  const methodLabel = (method: string) =>
    method === "exact"
      ? t("methodExact")
      : method === "alias"
        ? t("methodAlias")
        : method === "fuzzy"
          ? t("methodFuzzy")
          : t("methodAi");

  const askAi = async (mode: TagAiMode, tagName: string): Promise<AiState> => {
    const key = aiKey(mode, tagName);
    setAi((prev) => ({ ...prev, [key]: { loading: true } }));
    let next: AiState;
    try {
      const res = await fetch(`/api/governance/tags/normalization/ai?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode, tagName, subscriptionId: selectedSubscription }),
      });
      const json = (await res.json().catch(() => ({}))) as TagAiSuggestionResult | { aiAvailable?: undefined };
      if (!res.ok || json.aiAvailable === undefined) next = { reason: "error" };
      else if (!json.aiAvailable) next = { reason: json.reason };
      else {
        next = {
          picks: Object.fromEntries(
            json.suggestions.map((s) => [
              mode === "fill" ? s.target.toLowerCase() : s.target,
              { value: s.suggestion, confidence: s.confidence },
            ]),
          ),
        };
      }
    } catch {
      next = { reason: "error" };
    }
    setAi((prev) => ({ ...prev, [key]: next }));
    return next;
  };

  const proposeFill = async (policy: TagPolicyRule, candidates: MissingTagCandidate[]) => {
    const { picks } = await askAi("fill", policy.tagName);
    if (!picks) return;
    // Sólo los que vio la IA (un lote); a los que no supo se les elige el valor a mano.
    const rows = candidates
      .filter((c) => c.inheritedValue === null && picks[c.resource.id.toLowerCase()])
      .map(({ resource }): FillRow => {
        const pick = picks[resource.id.toLowerCase()];
        return { resource, suggestion: pick.value, confidence: pick.confidence, value: pick.value ?? "", approved: false };
      });
    setFillRows((prev) => ({ ...prev, [policy.tagName.toLowerCase()]: rows }));
  };

  const updateFillRow = (tagName: string, id: string, patch: Partial<FillRow>) =>
    setFillRows((prev) => ({
      ...prev,
      [tagName.toLowerCase()]: (prev[tagName.toLowerCase()] ?? []).map((r) => (r.resource.id === id ? { ...r, ...patch } : r)),
    }));

  /** Manda los ids en lotes; devuelve los que quedaron aplicados y el primer error. */
  const postInChunks = async (url: string, ids: readonly string[], size: number, body: (chunk: string[]) => object) => {
    const ok: string[] = [];
    let firstError: string | undefined;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      try {
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body(chunk)) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
          throw new Error(json.details ? `${json.error} ${json.details}` : json.error || `HTTP ${res.status}`);
        }
        const failures = ((json.results ?? []) as { resourceId: string; success: boolean; error?: string }[]).filter(
          (r) => !r.success,
        );
        firstError ??= failures[0]?.error;
        const failed = new Set(failures.map((r) => r.resourceId.toLowerCase()));
        ok.push(...chunk.filter((id) => !failed.has(id.toLowerCase())));
      } catch (err) {
        firstError ??= errorMessage(err);
      }
    }
    return { ok, firstError };
  };

  const report = (done: number, total: number, firstError?: string) => {
    if (done === total) toast.success(t("applied", { count: done }));
    else if (done > 0) toast.warning(t("appliedPartial", { ok: done, total, fail: total - done }), { description: firstError });
    else toast.error(t("applyError"), { description: firstError });
  };

  const recordDecision = async (decision: Record<string, unknown>): Promise<{ aliasSaved?: boolean } | null> => {
    try {
      const res = await fetch(`/api/governance/tags/normalization?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers,
        body: JSON.stringify(decision),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      toast.error(t("decisionError"));
      return null;
    }
  };

  const applyNormalization = async (group: NonConformingValueGroup, value: string, suggestion: Suggestion | null) => {
    const ok: string[] = [];
    const changes: AppliedTagChange[] = [];
    let firstError: string | undefined;
    // Se corrige la clave tal como está escrita en cada recurso ("environment" o "Environment").
    for (const [tagKey, targets] of groupBy(group.targets, (x) => x.tagKey)) {
      const r = await postInChunks("/api/tags/apply-bulk", targets.map((x) => x.id), BULK_LIMIT, (chunk) => ({
        tenantId,
        resourceIds: chunk,
        tags: { [tagKey]: value },
      }));
      ok.push(...r.ok);
      changes.push(...r.ok.map((id) => ({ id, tags: { [tagKey]: value } })));
      firstError ??= r.firstError;
    }
    report(ok.length, group.targets.length, firstError);
    if (!ok.length) return;
    onTagsApplied(changes);
    const saved = await recordDecision({
      tagName: group.tagName,
      originalValue: group.value,
      suggestedValue: suggestion?.value ?? null,
      suggestionSource: suggestion?.source ?? null,
      suggestedMethod: suggestion?.method ?? null,
      suggestedConfidence: suggestion?.confidence ?? null,
      appliedValue: value,
      resourceCount: ok.length,
      saveAlias,
    });
    if (saved?.aliasSaved) toast.success(t("aliasSaved", { from: group.value, to: value }));
    refreshKpis();
  };

  const applyInheritance = async (policy: TagPolicyRule, candidates: MissingTagCandidate[]) => {
    const valueById = new Map(candidates.map((c) => [c.resource.id, c.inheritedValue ?? ""]));
    const { ok, firstError } = await postInChunks(
      "/api/governance/tags/apply-inheritance",
      [...valueById.keys()],
      INHERIT_LIMIT,
      (chunk) => ({
        tenantId,
        dryRun: false,
        ops: chunk.map((id) => ({ resourceId: id, tagsToMerge: { [policy.tagName]: valueById.get(id) } })),
      }),
    );
    report(ok.length, valueById.size, firstError);
    if (!ok.length) return;
    onTagsApplied(ok.map((id) => ({ id, tags: { [policy.tagName]: valueById.get(id) ?? "" } })));
    // Heredar cuenta como resuelto por regla: una decisión por valor heredado.
    for (const [value, ids] of groupBy(ok, (id) => valueById.get(id) ?? "")) {
      await recordDecision({
        tagName: policy.tagName,
        originalValue: "",
        suggestedValue: value,
        suggestionSource: "rule",
        suggestedMethod: "inheritance",
        suggestedConfidence: 1,
        appliedValue: value,
        resourceCount: ids.length,
      });
    }
    refreshKpis();
  };

  const applyFill = async (policy: TagPolicyRule, rows: FillRow[]) => {
    const okIds = new Set<string>();
    let firstError: string | undefined;
    for (const [value, sameValue] of groupBy(rows, (r) => r.value)) {
      const r = await postInChunks("/api/tags/apply-bulk", sameValue.map((x) => x.resource.id), BULK_LIMIT, (chunk) => ({
        tenantId,
        resourceIds: chunk,
        tags: { [policy.tagName]: value },
      }));
      r.ok.forEach((id) => okIds.add(id));
      firstError ??= r.firstError;
    }
    report(okIds.size, rows.length, firstError);
    const applied = rows.filter((r) => okIds.has(r.resource.id));
    if (!applied.length) return;
    onTagsApplied(applied.map((r) => ({ id: r.resource.id, tags: { [policy.tagName]: r.value } })));
    const key = policy.tagName.toLowerCase();
    setFillRows((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((r) => !okIds.has(r.resource.id)) }));
    // Una decisión por (propuesta de la IA, valor aplicado): así se mide cuánto se le acepta.
    for (const same of groupBy(applied, (r) => `${r.suggestion ?? ""}\u0000${r.value}`).values()) {
      const { suggestion, value } = same[0];
      await recordDecision({
        tagName: policy.tagName,
        originalValue: "",
        suggestedValue: suggestion,
        suggestionSource: suggestion ? "ai" : null,
        suggestedMethod: suggestion ? "ai" : null,
        suggestedConfidence: suggestion ? same.reduce((s, r) => s + r.confidence, 0) / same.length : null,
        appliedValue: value,
        resourceCount: same.length,
      });
    }
    refreshKpis();
  };

  const dismiss = async (group: NonConformingValueGroup) => {
    const suggestion = suggestionOf(group);
    setDismissed((prev) => new Set(prev).add(groupKey(group)));
    if (!suggestion) return;
    await recordDecision({
      tagName: group.tagName,
      originalValue: group.value,
      suggestedValue: suggestion.value,
      suggestionSource: suggestion.source,
      suggestedMethod: suggestion.method,
      suggestedConfidence: suggestion.confidence,
      appliedValue: null,
      resourceCount: group.targets.length,
    });
    refreshKpis();
  };

  const openConfirm = (p: Pending) => {
    setSaveAlias(false);
    setPending(p);
  };

  const runPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "normalize") await applyNormalization(pending.group, pending.value, pending.suggestion);
      else if (pending.kind === "inherit") await applyInheritance(pending.policy, pending.candidates);
      else await applyFill(pending.policy, pending.rows);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const kpiLine = (() => {
    if (!kpis) return null;
    const { rule, ai: byAi, manual } = kpis.resolvedResources;
    const total = rule + byAi + manual;
    const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return {
      resolved:
        total > 0
          ? t("kpiResolved", { days: kpis.periodDays, total, rule: share(rule), ai: share(byAi), manual: share(manual) })
          : t("kpiNone", { days: kpis.periodDays }),
      acceptance:
        kpis.acceptanceRatePct === null
          ? null
          : t("kpiAcceptance", {
              rate: kpis.acceptanceRatePct,
              accepted: kpis.suggestionsAccepted,
              decided: kpis.suggestionsDecided,
            }),
    };
  })();

  const confirmContent = (() => {
    if (!pending) return null;
    if (pending.kind === "normalize") {
      const { group, value, suggestion } = pending;
      const offerAlias =
        tagValueKey(group.value) !== tagValueKey(value) && !(suggestion?.method === "alias" && suggestion.value === value);
      return {
        text: t("confirmNormalize", { tag: group.tagName, from: group.value, to: value, count: group.targets.length }),
        names: group.targets.map((x) => x.name),
        alias: offerAlias ? t("saveAlias", { from: group.value, to: value }) : null,
      };
    }
    if (pending.kind === "inherit") {
      return {
        text: t("confirmInherit", { tag: pending.policy.tagName, count: pending.candidates.length }),
        names: pending.candidates.map((c) => `${c.resource.resourceName} → ${c.inheritedValue}`),
        alias: null,
      };
    }
    return {
      text: t("confirmFill", { tag: pending.policy.tagName, count: pending.rows.length }),
      names: pending.rows.map((r) => `${r.resource.resourceName} → ${r.value}`),
      alias: null,
    };
  })();

  return (
    <div
      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4"
      data-testid="tag-non-conforming"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <IconTagOff size={20} className="text-[#0078D4]" stroke={1.5} />
          <h2 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">{t("title")}</h2>
          <InfoTooltip content={t("titleTip")} />
        </div>
        {kpiLine && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-right space-y-0.5" data-testid="tag-normalization-kpis">
            <div>{kpiLine.resolved}</div>
            {kpiLine.acceptance && <div>{kpiLine.acceptance}</div>}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-slate-400">{t("empty")}</p>
      ) : (
        <>
          <div className="w-full overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-[#1B2A41] dark:text-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-bold">{t("colTag")}</th>
                  <th className="py-2.5 px-3 font-bold">{t("colValue")}</th>
                  <th className="py-2.5 px-3 font-bold">{t("colResources")}</th>
                  <th className="py-2.5 px-3 font-bold">{t("colSuggestion")}</th>
                  <th className="py-2.5 px-3 font-bold">{t("colOrigin")}</th>
                  <th className="py-2.5 px-3 font-bold text-right">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pag.paged.map((g) => {
                  const key = groupKey(g);
                  const suggestion = suggestionOf(g);
                  const value = choice[key] ?? suggestion?.value ?? "";
                  const aiState = ai[aiKey("normalize", g.tagName)];
                  return (
                    <tr key={key} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-semibold text-[#1B2A41] dark:text-white">{g.tagName}</td>
                      <td className="py-2 px-3">
                        <code className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          {g.value}
                        </code>
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300" title={g.targets.slice(0, 10).map((x) => x.name).join(", ")}>
                        {g.targets.length}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={value}
                          onChange={(e) => setChoice((prev) => ({ ...prev, [key]: e.target.value }))}
                          className={selectCls}
                          aria-label={t("colSuggestion")}
                        >
                          <option value="">{t("chooseValue")}</option>
                          {allowedOf(g.tagName).map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        {suggestion ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              suggestion.source === "ai"
                                ? "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
                                : "bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] dark:text-blue-300 border-blue-200 dark:border-blue-800"
                            }`}
                          >
                            {suggestion.source === "ai" && <IconSparkles size={11} stroke={1.8} />}
                            {methodLabel(suggestion.method)} · {pct(suggestion.confidence)}%
                          </span>
                        ) : aiState?.loading ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                            <IconLoader2 size={13} className="animate-spin" /> {t("suggestingAi")}
                          </span>
                        ) : aiState?.reason ? (
                          <span className="text-[11px] text-slate-500">{t(`aiReason_${aiState.reason}`)}</span>
                        ) : aiState?.picks ? (
                          <span className="text-[11px] text-slate-500">{t("aiNoAnswer")}</span>
                        ) : (
                          <button type="button" onClick={() => askAi("normalize", g.tagName)} className={btnOutline}>
                            <IconSparkles size={13} stroke={1.5} />
                            {t("suggestAi")}
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!value || !canApply || busy}
                            title={applyTitle}
                            onClick={() => openConfirm({ kind: "normalize", group: g, value, suggestion })}
                            className={btnPrimary}
                          >
                            {t("apply")}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismiss(g)}
                            title={t("dismissTip")}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <IconX size={13} stroke={1.5} />
                            {t("dismiss")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {groups.length > 10 && (
            <Pagination
              page={pag.page}
              setPage={pag.setPage}
              pageSize={pag.pageSize}
              setPageSize={pag.setPageSize}
              total={pag.total}
              totalPages={pag.totalPages}
            />
          )}
        </>
      )}

      {missing.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white">{t("missingTitle")}</h3>
            <InfoTooltip content={t("missingTip")} />
          </div>
          {missing.map(({ policy, candidates }) => {
            const inheritable = candidates.filter((c) => c.inheritedValue !== null);
            const rest = candidates.length - inheritable.length;
            const aiState = ai[aiKey("fill", policy.tagName)];
            const rows = fillRows[policy.tagName.toLowerCase()] ?? [];
            const approved = rows.filter((r) => r.approved && r.value);
            const vocabulary = tagVocabulary(resources, resourceGroups, policy.tagName);
            return (
              <div
                key={policy.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2"
                data-testid={`tag-missing-${policy.tagName}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-bold text-[#1B2A41] dark:text-white">{policy.tagName}</span>
                    {" · "}
                    {t("missingSummary", { count: candidates.length, inheritable: inheritable.length })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!inheritable.length || !canApply || busy}
                      title={applyTitle}
                      onClick={() => openConfirm({ kind: "inherit", policy, candidates: inheritable })}
                      className={btnOutline}
                    >
                      <IconArrowDownRight size={13} stroke={1.5} />
                      {t("inherit", { count: inheritable.length })}
                    </button>
                    <button
                      type="button"
                      disabled={!rest || aiState?.loading}
                      onClick={() => proposeFill(policy, candidates)}
                      className={btnOutline}
                    >
                      {aiState?.loading ? (
                        <IconLoader2 size={13} className="animate-spin" />
                      ) : (
                        <IconSparkles size={13} stroke={1.5} />
                      )}
                      {t("proposeAi", { count: rest })}
                    </button>
                  </div>
                </div>
                {aiState?.reason && <p className="text-[11px] text-slate-500">{t(`aiReason_${aiState.reason}`)}</p>}
                {rows.length > 0 && (
                  <>
                    <div className="w-full overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-[#1B2A41] dark:text-slate-200">
                          <tr>
                            <th className="py-2 px-3 font-bold">{t("colResource")}</th>
                            <th className="py-2 px-3 font-bold">{t("colProposed")}</th>
                            <th className="py-2 px-3 font-bold">{t("colConfidence")}</th>
                            <th className="py-2 px-3 font-bold text-center">{t("colApprove")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {rows.map((r) => (
                            <tr key={r.resource.id}>
                              <td className="py-1.5 px-3">
                                <div className="font-medium text-[#1B2A41] dark:text-white">{r.resource.resourceName}</div>
                                <div className="text-[10px] text-slate-400">{r.resource.resourceGroup}</div>
                              </td>
                              <td className="py-1.5 px-3">
                                <select
                                  value={r.value}
                                  onChange={(e) =>
                                    updateFillRow(policy.tagName, r.resource.id, {
                                      value: e.target.value,
                                      approved: r.approved && Boolean(e.target.value),
                                    })
                                  }
                                  className={selectCls}
                                  aria-label={t("colProposed")}
                                >
                                  <option value="">{t("chooseValue")}</option>
                                  {vocabulary.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-1.5 px-3 text-slate-600 dark:text-slate-300">
                                {r.suggestion ? `${pct(r.confidence)}%` : <span className="text-slate-400">{t("aiUnknown")}</span>}
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={r.approved}
                                  disabled={!r.value}
                                  onChange={(e) => updateFillRow(policy.tagName, r.resource.id, { approved: e.target.checked })}
                                  className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                                  aria-label={t("colApprove")}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={!approved.length || !canApply || busy}
                        title={applyTitle}
                        onClick={() => openConfirm({ kind: "fill", policy, rows: approved })}
                        className={btnPrimary}
                      >
                        {t("approvedApply", { count: approved.length })}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending && confirmContent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">{t("confirmTitle")}</h3>
            <p className="text-xs text-slate-700 dark:text-slate-300">{confirmContent.text}</p>
            <ul className="text-[11px] text-slate-500 dark:text-slate-400 list-disc pl-5 space-y-0.5">
              {confirmContent.names.slice(0, PREVIEW_NAMES).map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            {confirmContent.names.length > PREVIEW_NAMES && (
              <p className="text-[11px] text-slate-400">{t("andMore", { count: confirmContent.names.length - PREVIEW_NAMES })}</p>
            )}
            {confirmContent.alias && (
              <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAlias}
                  onChange={(e) => setSaveAlias(e.target.checked)}
                  className="mt-0.5 rounded text-[#0054A6] focus:ring-[#0054A6]"
                />
                <span>{confirmContent.alias}</span>
              </label>
            )}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={runPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#0054A6] text-white hover:bg-[#004589] disabled:opacity-50"
              >
                {busy && <IconLoader2 size={14} className="animate-spin" />}
                {busy ? t("applying") : t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
