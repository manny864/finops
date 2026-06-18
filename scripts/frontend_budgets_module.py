import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_i18n():
    locales = ["en.json", "es.json", "pt-BR.json"]
    new_keys = {
        "en": {
            "title": "Tenant Budgets",
            "subtitle": "Manage and visualize your monthly global limits.",
            "card_title": "Monthly Budget Status",
            "assigned_budget": "Assigned Budget",
            "alert_threshold": "Alert Threshold",
            "no_budget_configured": "No budget configured for this tenant.",
            "configure_btn": "Configure Budget"
        },
        "es": {
            "title": "Presupuestos del Tenant",
            "subtitle": "Gestiona y visualiza tus límites globales mensuales.",
            "card_title": "Estado del Presupuesto Mensual",
            "assigned_budget": "Presupuesto Asignado",
            "alert_threshold": "Umbral de Alerta",
            "no_budget_configured": "No hay presupuesto configurado para este tenant.",
            "configure_btn": "Configurar Presupuesto"
        },
        "pt-BR": {
            "title": "Orçamentos do Locatário",
            "subtitle": "Gerencie e visualize seus limites globais mensais.",
            "card_title": "Status do Orçamento Mensal",
            "assigned_budget": "Orçamento Atribuído",
            "alert_threshold": "Limite de Alerta",
            "no_budget_configured": "Nenhum orçamento configurado para este locatário.",
            "configure_btn": "Configurar Orçamento"
        }
    }
    
    for filename in locales:
        lang = filename.split(".")[0]
        if lang == "pt-BR":
            lang_key = "pt-BR"
        else:
            lang_key = lang
            
        filepath = os.path.join(base_dir, "messages", filename)
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            if "Budgets" not in data:
                data["Budgets"] = new_keys.get(lang_key, new_keys["en"])
                
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Updated i18n file: {filename}")

def create_budget_card():
    card_dir = os.path.join(base_dir, "src/components/budgets")
    os.makedirs(card_dir, exist_ok=True)
    card_path = os.path.join(card_dir, "BudgetCard.tsx")
    
    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';
import { Loader2, DollarSign, Bell } from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BudgetCard() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Budgets');
    
    const [loading, setLoading] = useState(false);
    const [budgetData, setBudgetData] = useState<any>(null);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            setBudgetData(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        // Mockeo temporal de la API
        const fetchMockData = async () => {
            // Simulamos retraso de red
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            if (isMounted) {
                // TODO: Conectar a API real /api/intelligence/budgets
                // Simulamos que el tenant tiene un presupuesto o no de manera aleatoria
                const hasBudget = Math.random() > 0.3;
                
                if (hasBudget) {
                    setBudgetData({
                        budget_usd: 5000.00,
                        alert_threshold: 80.00
                    });
                } else {
                    setBudgetData(null);
                }
                setLoading(false);
            }
        };

        fetchMockData();

        return () => {
            isMounted = false;
        };
    }, [selectedTenant]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6 max-w-lg">
            <h3 className="text-lg font-bold text-gray-800 mb-2">{t('card_title')}</h3>
            
            {loading ? (
                // Skeleton Loader
                <div className="animate-pulse flex flex-col gap-4 mt-6">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-8 bg-gray-200 rounded w-1/2 mt-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                </div>
            ) : budgetData ? (
                <div className="mt-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-brand-soft rounded-full text-brand-deep">
                            <DollarSign className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('assigned_budget')}</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {currencyFormatter.format(budgetData.budget_usd)}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 mt-2">
                        <div className="p-3 bg-amber-50 rounded-full text-amber-500">
                            <Bell className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('alert_threshold')}</p>
                            <p className="text-lg font-bold text-gray-900">
                                {budgetData.alert_threshold}%
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mt-6 text-sm text-gray-400 h-32 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-100 rounded-lg">
                    <p className="mb-3">{t('no_budget_configured')}</p>
                    <button className="px-4 py-2 bg-brand-deep text-white rounded-md text-xs font-bold hover:bg-brand-bright transition-colors">
                        {t('configure_btn')}
                    </button>
                </div>
            )}
        </div>
    );
}
"""
    with open(card_path, "w", encoding="utf-8") as f:
        f.write(code)
    print(f"Created Component: {card_path}")

def create_page():
    page_dir = os.path.join(base_dir, "src/app/[locale]/intelligence/budgets")
    os.makedirs(page_dir, exist_ok=True)
    page_path = os.path.join(page_dir, "page.tsx")
    
    code = """import React from 'react';
import { getTranslations } from 'next-intl/server';
import BudgetCard from '@/components/budgets/BudgetCard';

export default async function BudgetsPage() {
    const t = await getTranslations('Budgets');

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📊</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <BudgetCard />
        </div>
    );
}
"""
    with open(page_path, "w", encoding="utf-8") as f:
        f.write(code)
    print(f"Created Page: {page_path}")

if __name__ == "__main__":
    update_i18n()
    create_budget_card()
    create_page()
    print("Módulo Frontend de presupuestos implementado.")
