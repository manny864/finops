"use client";
import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as LucideIcons from "lucide-react";
import type { PageEntry } from "@/lib/pageRegistry";

interface Props {
    entry: PageEntry;
}

/**
 * Tarjeta "acceso directo" para pins de página (sin widget rico registrado).
 * Muestra título, descripción y CTA al destino.
 */
export default function ShortcutWidget({ entry }: Props) {
    const params = useParams();
    const locale = (params?.locale as string) || "es";
    const href = `/${locale}${entry.path}`;
    const Icon = (LucideIcons as any)[entry.icon] || LucideIcons.LayoutDashboard;

    return (
        <Link
            href={href}
            className="group flex flex-col h-full p-4 rounded-lg border border-transparent hover:border-brand-deep/30 hover:bg-brand-deep/5 dark:hover:bg-brand-deep/10 transition-colors no-underline"
        >
            <div className="flex items-start gap-3 mb-2">
                <div className="p-2 rounded-md bg-brand-deep/10 dark:bg-brand-deep/20 text-brand-deep flex-shrink-0">
                    <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">{entry.category}</div>
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{entry.title}</div>
                </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 mb-3">{entry.description}</p>
            <div className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-deep group-hover:underline">
                Abrir tablero <LucideIcons.ArrowRight className="w-3.5 h-3.5" />
            </div>
        </Link>
    );
}
