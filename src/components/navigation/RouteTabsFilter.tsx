"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";

export default function RouteTabsFilter() {
    const t = useTranslations("TabFilters");
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const currentValue = useMemo(() => searchParams.get("q") || "", [searchParams]);
    const [value, setValue] = useState(currentValue);

    useEffect(() => {
        setValue(currentValue);
    }, [currentValue]);

    const apply = (nextValue: string) => {
        startTransition(() => {
            const params = new URLSearchParams(searchParams.toString());
            const trimmed = nextValue.trim();
            if (trimmed) params.set("q", trimmed);
            else params.delete("q");
            const query = params.toString();
            router.replace(`${pathname}${query ? `?${query}` : ""}` as any);
        });
    };

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        apply(value);
    };

    const clear = () => {
        setValue("");
        apply("");
    };

    return (
        <form onSubmit={onSubmit} className="px-6 mb-4">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={t("placeholder")}
                    className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 outline-none"
                />
                {value ? (
                    <button
                        type="button"
                        onClick={clear}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label={t("clear")}
                    >
                        <X className="w-4 h-4" />
                    </button>
                ) : null}
                <button
                    type="submit"
                    disabled={isPending}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#0054A6] text-white hover:bg-[#00458A] disabled:opacity-60"
                >
                    {t("apply")}
                </button>
            </div>
        </form>
    );
}
