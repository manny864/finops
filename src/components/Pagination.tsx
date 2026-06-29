"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function usePagination<T>(items: T[] | undefined | null, initialPageSize = 10) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(initialPageSize);
    const total = items?.length || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);

    const paged = useMemo(() => {
        if (!items) return [] as T[];
        const start = (page - 1) * pageSize;
        return items.slice(start, start + pageSize);
    }, [items, page, pageSize]);

    return { page, setPage, pageSize, setPageSize, total, totalPages, paged };
}

interface PaginationProps {
    page: number;
    setPage: (p: number | ((p: number) => number)) => void;
    pageSize: number;
    setPageSize: (s: number) => void;
    total: number;
    totalPages: number;
    pageSizes?: number[];
    labels?: { showing?: string; of?: string; perPage?: string; prev?: string; next?: string; page?: string };
}

export default function Pagination({ page, setPage, pageSize, setPageSize, total, totalPages, pageSizes = [10, 25, 50, 100], labels }: PaginationProps) {
    const L = {
        showing: labels?.showing ?? 'Mostrando',
        of: labels?.of ?? 'de',
        perPage: labels?.perPage ?? '/ pág',
        prev: labels?.prev ?? 'Anterior',
        next: labels?.next ?? 'Siguiente',
        page: labels?.page ?? 'Página'
    };
    if (total <= Math.min(...pageSizes)) return null;
    const safePage = Math.min(page, totalPages);
    const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const to = Math.min(safePage * pageSize, total);

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1 text-sm">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                <span>{L.showing} <strong className="text-gray-900 dark:text-white">{from}-{to}</strong> {L.of} <strong className="text-gray-900 dark:text-white">{total}</strong></span>
                <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer"
                >
                    {pageSizes.map(s => <option key={s} value={s}>{s} {L.perPage}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setPage(p => Math.max(1, (typeof p === 'number' ? p : 1) - 1))}
                    disabled={safePage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                    <ChevronLeft className="w-3.5 h-3.5" /> {L.prev}
                </button>
                <span className="text-gray-700 dark:text-gray-300 font-bold px-2">{L.page} {safePage} / {totalPages}</span>
                <button
                    onClick={() => setPage(p => Math.min(totalPages, (typeof p === 'number' ? p : 1) + 1))}
                    disabled={safePage >= totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                    {L.next} <ChevronRight className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
