"use client";
import { useTranslations } from "next-intl";
import React, { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Activity, Trash2, Clock, Tag, ShieldCheck, Play } from 'lucide-react';

export default function CommandPalette() {
  const t = useTranslations("CommandPalette");
  const [open, setOpen] = useState(false);
  const router = useRouter();

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
  
  const runCommand = useCallback((command: () => unknown) => {
    setOpen(false);
    command();
  }, []);
  
  return (
    <Command.Dialog 
      open={open} 
      onOpenChange={setOpen} 
      label="Global Command Menu"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-gray-900/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        <Command.Input 
           placeholder={t("searchPlaceholder")} 
           className="w-full px-5 py-4 text-lg border-b border-gray-100 outline-none placeholder:text-gray-400 text-gray-900 bg-transparent font-medium"
        />
        <Command.List className="max-h-[350px] overflow-y-auto p-2 scroll-py-2 custom-scrollbar">
          <Command.Empty className="py-10 text-center text-sm text-gray-500">
            {t("empty")}
          </Command.Empty>

          <Command.Group heading={t("navigation")} className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
            <Command.Item onSelect={() => runCommand(() => router.push('/'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <LayoutDashboard className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Dashboard Principal
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/intelligence/billing'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <FileText className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("monthlyBilling")}
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/intelligence/rightsizing'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Activity className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("cmdRightsizing")}
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/zombies'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Trash2 className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("zombieResources")}
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/ttl'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Clock className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("ttlPolicies")}
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/governance/tags'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Tag className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("tagManagement")}
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/admin/onboarding'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <ShieldCheck className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              {t("cmdOnboarding")}
            </Command.Item>
          </Command.Group>

          <Command.Group heading={t("quickActions")} className="px-3 py-2 mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-t border-gray-100">
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/zombies'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center group">
              <div className="w-6 h-6 mr-3 rounded-full bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center">
                  <Play className="w-3 h-3 text-indigo-600" />
              </div>
              {t("runAudit")}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
