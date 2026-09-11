"use client";
import { useTranslations } from "next-intl";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Activity, Trash2, Clock, Tag, ShieldCheck, Play, Server, Boxes, CreditCard, Recycle, BellRing, Loader2 } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';

interface ContentHit {
  kind: 'service' | 'resourceGroup' | 'subscription' | 'waste' | 'alertRule';
  title: string;
  subtitleKey?: string;
  subtitleParams?: Record<string, string | number>;
  href: string;
}

const KIND_ICON = {
  service: Server,
  resourceGroup: Boxes,
  subscription: CreditCard,
  waste: Recycle,
  alertRule: BellRing,
} as const;

/**
 * El buscador se dispara al tipear: sin debounce cada tecla es una consulta a
 * MySQL por cada uno de los cinco origenes.
 */
const DEBOUNCE_MS = 250;

export default function CommandPalette() {
  const t = useTranslations("CommandPalette");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const tenantId = selectedTenant?.id || '';

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [partial, setPartial] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2 || !tenantId || tenantId === 'default') {
      setHits([]);
      setPartial(false);
      return;
    }

    const timer = setTimeout(async () => {
      // Una respuesta vieja que llega tarde no puede pisar a la nueva.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const headers: Record<string, string> = {};
        if (!isMockTenant(tenantId) && accounts.length > 0) {
          const token = await getFreshIdToken(instance, accounts[0]);
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(
          `/api/search?tenantId=${encodeURIComponent(tenantId)}&q=${encodeURIComponent(term)}`,
          { headers, signal: controller.signal }
        );
        const json = await res.json();
        setHits(Array.isArray(json.results) ? json.results : []);
        setPartial((json.sourceStatus || []).some((s: { ok: boolean }) => !s.ok));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[CommandPalette] búsqueda fallida:', err);
          setHits([]);
        }
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open, tenantId, instance, accounts]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Support for both Cmd+K (Mac) and Ctrl+K (Windows/Linux)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);
  
  // El listado de navegacion como datos: antes eran siete bloques JSX iguales
  // y no se podian filtrar por el termino buscado.
  const navItems = React.useMemo(() => [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/intelligence/billing', label: t('monthlyBilling'), icon: FileText },
    { href: '/intelligence/rightsizing', label: t('cmdRightsizing'), icon: Activity },
    { href: '/cleanup/zombies', label: t('zombieResources'), icon: Trash2 },
    { href: '/cleanup/ttl', label: t('ttlPolicies'), icon: Clock },
    { href: '/governance/tags', label: t('tagManagement'), icon: Tag },
    { href: '/admin/onboarding', label: t('cmdOnboarding'), icon: ShieldCheck },
  ], [t]);

  const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matchesQuery = (item: { label: string }) => {
    const term = query.trim();
    return !term || normalize(item.label).includes(normalize(term));
  };

  const runCommand = useCallback((command: () => unknown) => {
    setOpen(false);
    command();
  }, []);
  
  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) setQuery(''); }}
      shouldFilter={false}
      label="Global Command Menu"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-gray-900/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        <Command.Input
           value={query}
           onValueChange={setQuery}
           placeholder={t("searchPlaceholder")} 
           className="w-full px-5 py-4 text-lg border-b border-gray-100 outline-none placeholder:text-gray-400 text-gray-900 bg-transparent font-medium"
        />
        <Command.List className="max-h-[350px] overflow-y-auto p-2 scroll-py-2 custom-scrollbar">
          <Command.Empty className="py-10 text-center text-sm text-gray-500">
            {t("empty")}
          </Command.Empty>

          {/*
            * Con shouldFilter={false} cmdk deja de filtrar: los resultados del
            * servidor ya vienen filtrados y volver a pasarlos por el matcher
            * local escondia aciertos (busca "rg-analytics" y el subtitulo no
            * matchea). A cambio, la navegacion se filtra a mano aca.
            */}
          {navItems.filter(matchesQuery).length > 0 && (
            <Command.Group heading={t("navigation")} className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
              {navItems.filter(matchesQuery).map((item) => (
                <Command.Item
                  key={item.href}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => runCommand(() => router.push(item.href))}
                  className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 dark:text-slate-200 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-800 aria-selected:bg-indigo-50 dark:aria-selected:bg-slate-800 transition-colors flex items-center"
                >
                  <item.icon className="w-4 h-4 mr-3 text-gray-400" />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {query.trim().length >= 2 && (
            <Command.Group heading={t("contentGroup")} className="px-3 py-2 mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-t border-gray-100 dark:border-slate-800">
              {searching && (
                <div className="px-3 py-2.5 text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0078D4]" />
                  {t("searching")}
                </div>
              )}
              {!searching && partial && (
                <p className="px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">{t("partialSources")}</p>
              )}
              {hits.map((hit, i) => {
                const Icon = KIND_ICON[hit.kind];
                return (
                  <Command.Item
                    key={`${hit.kind}-${hit.title}-${i}`}
                    value={`${hit.kind}-${hit.title}-${i}`}
                    onSelect={() => runCommand(() => router.push(hit.href))}
                    className="cursor-pointer px-3 py-2.5 mt-1 text-sm rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-800 aria-selected:bg-indigo-50 dark:aria-selected:bg-slate-800 transition-colors flex items-center gap-3"
                  >
                    <Icon className="w-4 h-4 text-[#0078D4] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-800 dark:text-slate-100 truncate">{hit.title}</span>
                      {hit.subtitleKey && (
                        <span className="block text-[11px] text-gray-500 dark:text-slate-400 truncate">
                          {t(hit.subtitleKey as never, hit.subtitleParams as never)}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                      {t(`kind_${hit.kind}` as never)}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-gray-500">{t("searchHint")}</p>
          )}

        </Command.List>
      </div>
    </Command.Dialog>
  );
}
