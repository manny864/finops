"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { Megaphone, Plus, X, Pencil, Trash2, Ban, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import {
  BASE_LOCALE,
  TRANSLATABLE_LOCALES,
  type AnnouncementChannel,
  type AnnouncementSeverity,
  type AnnouncementTranslation,
  type CreateAnnouncementInput,
  type SystemAnnouncement,
} from "@/types/systemAnnouncements.types";

export interface TenantOption {
  tenantId: string;
  organizationName: string;
  subscriptionStatus: string;
  planTier: string;
}

/**
 * Se excluyen sólo los CANCELED: sus usuarios ya no entran, así que dirigirles
 * un anuncio no sirve de nada. TRIAL y PAST_DUE SÍ aparecen -- siguen usando la
 * plataforma, y un PAST_DUE es justamente a quien se le quiere avisar algo.
 */
export const isTargetableTenant = (t: TenantOption) => String(t.subscriptionStatus).toUpperCase() !== "CANCELED";

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL: "bg-blue-50 text-[#0054A6] dark:bg-blue-950/40 dark:text-blue-300",
  PAST_DUE: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

const LOCALE_LABEL: Record<string, string> = {
  es: "Español",
  en: "Inglés",
  "pt-BR": "Portugués (BR)",
};

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: "Info",
  maintenance: "Mantenimiento",
  warning: "Advertencia",
  critical: "Crítico",
};

const SEVERITY_BADGE: Record<AnnouncementSeverity, string> = {
  info: "bg-blue-50 text-[#0054A6] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  maintenance: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  critical: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
};

const DISPLAY_STATUS_LABEL: Record<SystemAnnouncement["displayStatus"], string> = {
  draft: "Borrador",
  scheduled: "Programado",
  active: "Activo",
  finished: "Finalizado",
  cancelled: "Cancelado",
};

const DISPLAY_STATUS_BADGE: Record<SystemAnnouncement["displayStatus"], string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  scheduled: "bg-blue-50 text-[#0054A6] dark:bg-blue-950/40 dark:text-blue-300",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  finished: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  cancelled: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
};

/** `datetime-local` no entiende ISO con "Z"; recorta a minutos. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM: CreateAnnouncementInput = {
  title: "",
  message: "",
  translations: {},
  severity: "info",
  channels: ["banner"],
  targetAllTenants: true,
  targetTenantIds: [],
  actionUrl: "",
  startsAt: "",
  endsAt: "",
  status: "draft",
};

export default function SystemAnnouncementsPanel() {
  const t = useTranslations("SuperAdminAnnouncements");
  const { instance, accounts } = useMsal();
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateAnnouncementInput>(EMPTY_FORM);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantSearch, setTenantSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const authedFetch = useCallback(
    (url: string, opts: RequestInit & { headers?: Record<string, string> } = {}) =>
      fetchWithAuthRetry(instance, accounts[0], url, opts),
    [instance, accounts]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/super-admin/announcements");
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo cargar el listado.");
      setAnnouncements(json.announcements);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { load(); }, [load]);

  /**
   * Se cargan al abrir el modal y no al montar el panel: la lista sólo hace
   * falta para elegir alcance específico, que es el caso menos frecuente.
   * Una sola vez por sesión del panel -- no cambia mientras se edita.
   */
  const loadTenants = useCallback(async () => {
    if (tenants.length > 0 || tenantsLoading) return;
    setTenantsLoading(true);
    setTenantsError(null);
    try {
      const res = await authedFetch("/api/superadmin/tenants");
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo cargar la lista de tenants.");
      setTenants((json.tenants || []).filter(isTargetableTenant));
    } catch (e) {
      // No es fatal: el anuncio se puede guardar igual, y si se está editando
      // uno ya dirigido, sus IDs siguen intactos en el formulario.
      setTenantsError(errorMessage(e));
    } finally {
      setTenantsLoading(false);
    }
  }, [authedFetch, tenants.length, tenantsLoading]);

  const selectedTenantIds = form.targetTenantIds || [];

  const visibleTenants = tenants.filter((t) => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return true;
    return t.organizationName.toLowerCase().includes(q) || t.tenantId.toLowerCase().includes(q);
  });

  /** Seleccionados que no están en la lista cargada: ver el comentario en el JSX. */
  const orphanTenantIds = selectedTenantIds.filter((id) => !tenants.some((t) => t.tenantId === id));

  const toggleTenant = (tenantId: string) => {
    setForm((prev) => {
      const current = prev.targetTenantIds || [];
      return {
        ...prev,
        targetTenantIds: current.includes(tenantId)
          ? current.filter((id) => id !== tenantId)
          : [...current, tenantId],
      };
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTenantSearch("");
    setModalOpen(true);
    loadTenants();
  };

  const openEdit = (a: SystemAnnouncement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      message: a.message,
      translations: a.translations || {},
      severity: a.severity,
      channels: a.channels,
      targetAllTenants: a.targetAllTenants,
      targetTenantIds: a.targetTenantIds || [],
      actionUrl: a.actionUrl || "",
      startsAt: toDatetimeLocal(a.startsAt),
      endsAt: toDatetimeLocal(a.endsAt),
      status: a.status === "cancelled" ? "draft" : a.status,
    });
    setTenantSearch("");
    setModalOpen(true);
    loadTenants();
  };

  /** Las traducciones incompletas las descarta el servicio al guardar
   *  (`sanitizeTranslations`), así que acá alcanza con reflejar lo tipeado. */
  const setTranslationField = (locale: string, field: keyof AnnouncementTranslation, value: string) => {
    setForm((prev) => ({
      ...prev,
      translations: {
        ...(prev.translations || {}),
        [locale]: { title: "", message: "", ...(prev.translations?.[locale] || {}), [field]: value },
      },
    }));
  };

  const toggleChannel = (ch: AnnouncementChannel) => {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(ch) ? prev.channels.filter((c) => c !== ch) : [...prev.channels, ch],
    }));
  };

  const handleSave = async (publish: boolean) => {
    if (!form.title.trim() || !form.message.trim() || !form.startsAt || !form.endsAt) {
      toast.error(t("errMissingFields"));
      return;
    }
    if (form.channels.length === 0) {
      toast.error(t("errNoChannel"));
      return;
    }

    const payload: CreateAnnouncementInput = {
      ...form,
      status: publish ? "published" : "draft",
      targetTenantIds: form.targetAllTenants ? [] : (form.targetTenantIds || []),
      // datetime-local no lleva zona horaria; se interpreta como hora local
      // del servidor (misma convención que el resto de la plataforma, que no
      // tiene selector de timezone en ningún formulario existente).
      startsAt: form.startsAt,
      endsAt: form.endsAt,
    };

    setSaving(true);
    try {
      const url = editingId ? `/api/super-admin/announcements/${editingId}` : "/api/super-admin/announcements";
      const res = await authedFetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo guardar.");
      toast.success(editingId ? "Anuncio actualizado." : "Anuncio creado.");
      setModalOpen(false);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (a: SystemAnnouncement) => {
    if (!confirm(`¿Cancelar "${a.title}"? Deja de mostrarse de inmediato.`)) return;
    try {
      const res = await authedFetch(`/api/super-admin/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo cancelar.");
      toast.success("Anuncio cancelado.");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleDelete = async (a: SystemAnnouncement) => {
    if (!confirm(`¿Eliminar "${a.title}" definitivamente? No se puede deshacer.`)) return;
    try {
      const res = await authedFetch(`/api/super-admin/announcements/${a.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo eliminar.");
      toast.success("Anuncio eliminado.");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="content animate-in fade-in p-6 w-full max-w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 !text-[#0054A6]" />
            <h1 className="text-xl font-bold text-ink dark:text-white font-heading">Comunicaciones Globales</h1>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#0054A6] text-white hover:bg-[#004a90] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 !text-white" />
          Nuevo anuncio
        </button>
      </div>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-ink-soft" /></div>
        ) : announcements.length === 0 ? (
          <div className="p-10 text-center text-xs text-ink-soft">{t("empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 border-b border-line">
                <tr className="text-left text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{t("fieldTitle")}</th>
                  <th className="px-4 py-2.5 font-semibold">Severidad</th>
                  <th className="px-4 py-2.5 font-semibold">Canales</th>
                  <th className="px-4 py-2.5 font-semibold">Idiomas</th>
                  <th className="px-4 py-2.5 font-semibold">Alcance</th>
                  <th className="px-4 py-2.5 font-semibold">Vigencia</th>
                  <th className="px-4 py-2.5 font-semibold">Estado</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {announcements.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5 font-semibold text-ink max-w-[260px] truncate">{a.title}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${SEVERITY_BADGE[a.severity]}`}>
                        {SEVERITY_LABEL[a.severity]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{a.channels.join(" + ")}</td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {/* El base siempre está; los demás sólo si se tradujeron. */}
                      {[BASE_LOCALE, ...Object.keys(a.translations || {})].join(", ")}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {a.targetAllTenants ? "Todos" : `${a.targetTenantIds?.length || 0} tenant(s)`}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                      {new Date(a.startsAt).toLocaleDateString()} – {new Date(a.endsAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${DISPLAY_STATUS_BADGE[a.displayStatus]}`}>
                        {DISPLAY_STATUS_LABEL[a.displayStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(a)} className="p-1.5 rounded text-ink-soft hover:text-[#0054A6] hover:bg-surface-2" title="Editar">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {a.displayStatus !== "cancelled" && a.displayStatus !== "finished" && (
                          <button onClick={() => handleCancel(a)} className="p-1.5 rounded text-ink-soft hover:text-amber-600 hover:bg-surface-2" title="Cancelar">
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(a)} className="p-1.5 rounded text-ink-soft hover:text-rose-600 hover:bg-surface-2" title="Eliminar">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                {editingId ? "Editar anuncio" : "Nuevo anuncio"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("fieldTitle")} <span className="font-normal text-slate-400">{t("baseLocaleHint", { locale: LOCALE_LABEL[BASE_LOCALE] })}</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                  placeholder="Ej: Mantenimiento programado"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mensaje <span className="font-normal text-slate-400">(admite Markdown)</span>
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={4}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                  placeholder={t("bodyPlaceholder")}
                />
              </div>

              {/* Traducciones OPCIONALES: un aviso urgente tiene que poder
                  publicarse en un solo idioma. Cada locale sin traducir cae al
                  idioma base -- ver resolveAnnouncementContent. */}
              <details className="border border-slate-200 dark:border-slate-700 rounded-lg">
                <summary className="px-3 py-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300 select-none">
                  {t("translations")} <span className="font-normal text-slate-400">{t("translationsHint", { locale: LOCALE_LABEL[BASE_LOCALE] })}</span>
                </summary>
                <div className="p-3 pt-0 space-y-3">
                  {TRANSLATABLE_LOCALES.map((loc) => (
                    <div key={loc} className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
                      <p className="font-semibold text-slate-600 dark:text-slate-400">{LOCALE_LABEL[loc]}</p>
                      <input
                        type="text"
                        value={form.translations?.[loc]?.title || ""}
                        onChange={(e) => setTranslationField(loc, "title", e.target.value)}
                        placeholder={`Título en ${LOCALE_LABEL[loc]}`}
                        className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                      />
                      <textarea
                        value={form.translations?.[loc]?.message || ""}
                        onChange={(e) => setTranslationField(loc, "message", e.target.value)}
                        rows={3}
                        placeholder={`Mensaje en ${LOCALE_LABEL[loc]}`}
                        className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-400 pt-1">
                    {t("partialTranslationWarning")}
                  </p>
                </div>
              </details>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Severidad</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as AnnouncementSeverity })}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                  >
                    {Object.entries(SEVERITY_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Canales</label>
                  <div className="flex items-center gap-3 h-[38px]">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={form.channels.includes("banner")} onChange={() => toggleChannel("banner")} />
                      Banner
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={form.channels.includes("popup")} onChange={() => toggleChannel("popup")} />
                      Popup
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("startsAt")}</label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("endsAt")}</label>
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <input
                    type="checkbox"
                    checked={form.targetAllTenants}
                    onChange={(e) => setForm({ ...form, targetAllTenants: e.target.checked })}
                  />
                  {t("allTenants")}
                </label>
                {!form.targetAllTenants && (
                  <div className="mt-1.5 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={tenantSearch}
                        onChange={(e) => setTenantSearch(e.target.value)}
                        placeholder={t("searchTenants")}
                        className="w-full bg-transparent text-ink dark:text-white outline-none"
                      />
                      <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                        {selectedTenantIds.length} seleccionado{selectedTenantIds.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {tenantsLoading ? (
                      <div className="p-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-ink-soft" /></div>
                    ) : tenantsError ? (
                      <div className="p-3 space-y-2">
                        <p className="text-rose-600 dark:text-rose-400">{tenantsError}</p>
                        <button type="button" onClick={loadTenants} className="underline font-semibold text-[#0054A6] dark:text-blue-300">
                          Reintentar
                        </button>
                      </div>
                    ) : (
                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleTenants.length === 0 && (
                          <p className="p-3 text-slate-400">{t("noTenantMatch")}</p>
                        )}
                        {visibleTenants.map((t) => (
                          <label
                            key={t.tenantId}
                            className="flex items-start gap-2 p-2 cursor-pointer select-none hover:bg-surface-2/60"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={selectedTenantIds.includes(t.tenantId)}
                              onChange={() => toggleTenant(t.tenantId)}
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="font-semibold text-ink dark:text-white truncate">{t.organizationName}</span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[String(t.subscriptionStatus).toUpperCase()] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                                  {t.subscriptionStatus}
                                </span>
                              </span>
                              {/* El ID completo, que es lo que se persiste. */}
                              <span className="block font-mono text-[11px] text-slate-400 break-all">{t.tenantId}</span>
                            </span>
                          </label>
                        ))}

                        {/* Un anuncio ya dirigido puede apuntar a un tenant que
                            hoy no está en la lista (dado de baja, o la carga
                            falló). Se muestra para poder desmarcarlo en vez de
                            perderlo en silencio al guardar. */}
                        {orphanTenantIds.map((id) => (
                          <label key={id} className="flex items-start gap-2 p-2 cursor-pointer select-none hover:bg-surface-2/60">
                            <input type="checkbox" className="mt-0.5" checked onChange={() => toggleTenant(id)} />
                            <span className="min-w-0">
                              <span className="font-semibold text-amber-700 dark:text-amber-400">{t("outOfList")}</span>
                              <span className="block font-mono text-[11px] text-slate-400 break-all">{id}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("actionLink")} <span className="font-normal text-slate-400">{t("optional")}</span>
                </label>
                <input
                  type="text"
                  value={form.actionUrl || ""}
                  onChange={(e) => setForm({ ...form, actionUrl: e.target.value })}
                  placeholder="https://finops.cscloudsolutions.com.ar/status"
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-ink dark:text-white"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Guardar borrador
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-[#0054A6] text-white hover:bg-[#004a90] disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Publicar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
