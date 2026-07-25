"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Alta de un tenant AWS. AWS no tiene un IdP corporativo equivalente a Entra
 * (ver docs/aws-multicloud-handoff.md §3.1), así que el alta no puede ser un
 * redirect de OAuth como la de Azure: es email + contraseña contra
 * `POST /api/auth/local/signup`.
 *
 * El plan viaja en el body porque el usuario ya eligió tarjeta en la grilla de
 * precios; el backend lo mapea a tier + estado de trial (PLAN_MAP), así que
 * mandar un plan inválido degrada a Essential en vez de romper.
 *
 * RBAC: ninguno, es pre-login. El endpoint tiene rate limit por IP (5/h) y
 * responde 409 explícito si el email ya existe.
 */
export default function LocalSignupForm({
    plan,
    onCancel,
}: {
    plan: string;
    onCancel: () => void;
}) {
    const t = useTranslations("provider");

    const [companyName, setCompanyName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await fetch("/api/auth/local/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyName, email, password, plan, provider: "aws" }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || t("signupError"));
                return;
            }
            setDone(true);
        } catch {
            setError(t("signupError"));
        } finally {
            setLoading(false);
        }
    };

    const inputClass =
        "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

    if (done) {
        return (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800" role="status">
                {t("signupSuccess")}
            </div>
        );
    }

    return (
        <form onSubmit={submit} className="space-y-3 text-left">
            <div>
                <label htmlFor="aws-company" className="mb-1 block text-xs font-semibold text-gray-700">
                    {t("signupCompany")}
                </label>
                <input
                    id="aws-company"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className={inputClass}
                />
            </div>
            <div>
                <label htmlFor="aws-email" className="mb-1 block text-xs font-semibold text-gray-700">
                    {t("signupEmail")}
                </label>
                <input
                    id="aws-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                />
            </div>
            <div>
                <label htmlFor="aws-password" className="mb-1 block text-xs font-semibold text-gray-700">
                    {t("signupPassword")}
                </label>
                <input
                    id="aws-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                />
            </div>

            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}

            <div className="flex gap-2 pt-1">
                <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? t("loading") : t("signupSubmit")}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    ✕
                </button>
            </div>
        </form>
    );
}
