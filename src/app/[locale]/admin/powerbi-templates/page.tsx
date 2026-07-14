"use client";
import React, { useEffect, useState } from "react";
import { BarChart3, Download, Copy, Check, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";

interface TemplateMeta {
    id: string; name: string; description: string;
    category: string; feedType: string;
    sampleVisualizations: string[];
    downloadUrl: string;
}
interface TemplateDetail extends TemplateMeta {
    powerQueryM: string;
}

export default function PowerBITemplatesPage() {
    const t = useTranslations("PowerBITemplates");
    const [list, setList] = useState<TemplateMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<TemplateDetail | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/templates/powerbi");
                const json = await res.json();
                if (json.success) setList(json.templates || []);
            } finally { setLoading(false); }
        })();
    }, []);

    const openDetail = async (id: string) => {
        setSelected(null);
        const res = await fetch(`/api/templates/powerbi/${id}`);
        const json = await res.json();
        if (json.success) setSelected(json.template);
    };

    const copyScript = () => {
        if (!selected) return;
        navigator.clipboard.writeText(selected.powerQueryM);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const categoryColors: Record<string, string> = {
        cost: "bg-blue-100 text-blue-700",
        sustainability: "bg-emerald-100 text-emerald-700",
        governance: "bg-amber-100 text-amber-700",
        "unit-economics": "bg-purple-100 text-purple-700",
    };

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6" /> {t("page_title")}</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-justify">
                    {t("page_desc")}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                    {t("mcp_key_hint")} <Link href="/admin/mcp-keys" className="text-blue-600 hover:underline">{t("mcp_key_link_text")}</Link>.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> {t("loading_templates")}</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {list.map(tpl => (
                        <div key={tpl.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 hover:shadow-md transition">
                            <div className="flex items-start justify-between mb-2">
                                <h3 className="font-semibold">{tpl.name}</h3>
                                <span className={`px-2 py-0.5 rounded text-xs ${categoryColors[tpl.category] || "bg-gray-100 text-gray-700"}`}>
                                    {tpl.category}
                                </span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 text-justify">{tpl.description}</p>
                            <div className="mb-3">
                                <p className="text-xs font-semibold uppercase text-gray-500 mb-1">{t("suggested_visualizations")}</p>
                                <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc ml-4 space-y-0.5">
                                    {tpl.sampleVisualizations.slice(0, 3).map((v, i) => <li key={i}>{v}</li>)}
                                </ul>
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button onClick={() => openDetail(tpl.id)}
                                    className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1">
                                    {t("view_script_btn")}
                                </button>
                                <a href={`${tpl.downloadUrl}?format=pq`}
                                    className="border border-blue-600 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-sm flex items-center gap-1"
                                    download={`${tpl.id}.pq`}>
                                    <Download className="w-4 h-4" /> .pq
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selected && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-bold">{selected.name}</h2>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{selected.description}</p>
                                </div>
                                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <p className="text-xs font-semibold uppercase text-gray-500 mb-1">{t("recommended_visualizations")}</p>
                                <ul className="text-sm list-disc ml-5 space-y-1">
                                    {selected.sampleVisualizations.map((v, i) => <li key={i}>{v}</li>)}
                                </ul>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-semibold uppercase text-gray-500">{t("power_query_m_label")}</p>
                                    <button onClick={copyScript} className="text-blue-600 hover:text-blue-700 text-xs flex items-center gap-1">
                                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        {copied ? t("copied") : t("copy")}
                                    </button>
                                </div>
                                <pre className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-x-auto max-h-96">
{selected.powerQueryM}
                                </pre>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded p-3 text-sm">
                                <p className="font-semibold mb-1">{t("steps_title")}</p>
                                <ol className="list-decimal ml-5 text-xs space-y-1">
                                    <li>{t("step1")}</li>
                                    <li>{t("step2")}</li>
                                    <li>{t("step3")}</li>
                                    <li>{t("step4")}</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
