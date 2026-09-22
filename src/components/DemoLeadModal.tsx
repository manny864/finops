"use client";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { Loader2 } from 'lucide-react';

interface DemoLeadModalProps {
    onSuccess: () => void;
    /** Si se provee, muestra una X para cerrar el modal sin completar (p.ej. en la página de precios). */
    onClose?: () => void;
    /**
     * Salida de emergencia SÓLO para cuando reCAPTCHA no carga.
     *
     * En /demo este modal es un portón duro a propósito: no recibe `onClose`, así
     * que no hay X y hay que dejar el lead para entrar. Pero si el script de
     * Google no carga --un adblocker alcanza-- el formulario no se puede enviar
     * NUNCA, y sin X el visitante queda encerrado en una pantalla muerta con el
     * login inalcanzable detrás. El mensaje que veía decía "recargá la página",
     * que con un bloqueador no arregla nada.
     *
     * Es un lead perdido en silencio, que es justo lo que el portón existe para
     * evitar. Se ofrece la salida únicamente en ese caso: el portón sigue entero
     * para todos los demás.
     */
    onVerificacionCaida?: () => void;
}

declare global {
    interface Window {
        grecaptcha: any;
    }
}

export default function DemoLeadModal({ onSuccess, onClose, onVerificacionCaida }: DemoLeadModalProps) {
    const t = useTranslations("DemoLead");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [verificacionCaida, setVerificacionCaida] = useState(false);
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        phone: '',
        companyName: ''
    });

    // Sondeo y no sólo `onError` del <Script>: varios bloqueadores no fallan la
    // request sino que devuelven un 200 vacío, así que `onError` nunca dispara y
    // `window.grecaptcha` igual no existe. Se mira el resultado, no el evento.
    useEffect(() => {
        if (!onVerificacionCaida) return;
        const t0 = Date.now();
        const id = setInterval(() => {
            if (window.grecaptcha) {
                clearInterval(id);
            } else if (Date.now() - t0 > 8000) {
                clearInterval(id);
                setVerificacionCaida(true);
            }
        }, 500);
        return () => clearInterval(id);
    }, [onVerificacionCaida]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (!window.grecaptcha) {
            setVerificacionCaida(true);
            setError(t("recaptchaError"));
            setLoading(false);
            return;
        }

        window.grecaptcha.ready(async () => {
            try {
                const token = await window.grecaptcha.execute('6Le3QDItAAAAAOq7sXMQyixQ7D8KVLO5jAuRH7J3', { action: 'demo_submit' });
                
                const res = await fetch('/api/leads/demo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...formData, recaptchaToken: token })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    onSuccess();
                } else {
                    setError(data.error || t("genericError"));
                }
            } catch (err) {
                console.error(err);
                setError(t("requestError"));
            } finally {
                setLoading(false);
            }
        });
    };

    return (
        <>
            <Script
                src="https://www.google.com/recaptcha/api.js?render=6Le3QDItAAAAAOq7sXMQyixQ7D8KVLO5jAuRH7J3"
                strategy="afterInteractive"
                onError={() => setVerificacionCaida(true)}
            />
            <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300 relative">
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t("close")}
                            className="absolute top-3 right-3 z-10 p-1.5 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    )}
                    <div className="p-8">
                        <div className="text-center mb-6">
                            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">{t("title")}</h2>
                            <p className="text-sm text-gray-500 mt-2">{t("subtitle")}</p>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">{t("fullName")}</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder={t("namePlaceholder")} 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white dark:bg-slate-800"
                                    value={formData.fullName}
                                    onChange={e => setFormData({...formData, fullName: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">{t("email")}</label>
                                <input 
                                    type="email" 
                                    required 
                                    placeholder="Ej. juan@empresa.com" 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white dark:bg-slate-800"
                                    value={formData.email}
                                    onChange={e => setFormData({...formData, email: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">{t("phone")}</label>
                                <input 
                                    type="tel" 
                                    required 
                                    placeholder="Ej. +54 11 1234-5678" 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white dark:bg-slate-800"
                                    value={formData.phone}
                                    onChange={e => setFormData({...formData, phone: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">{t("company")}</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder="Ej. CSCloudSolutions S.A." 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white dark:bg-slate-800"
                                    value={formData.companyName}
                                    onChange={e => setFormData({...formData, companyName: e.target.value})}
                                />
                            </div>

                            {verificacionCaida && onVerificacionCaida ? (
                                <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2">
                                    <p>{t("verificationDownTitle")}</p>
                                    <button
                                        type="button"
                                        onClick={onVerificacionCaida}
                                        className="w-full bg-white hover:bg-amber-100 text-amber-800 font-semibold py-2 px-4 rounded-lg border border-amber-300 transition-colors"
                                    >
                                        {t("verificationDownAction")}
                                    </button>
                                </div>
                            ) : error ? (
                                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                                    {error}
                                </div>
                            ) : null}

                            <button 
                                type="submit" 
                                disabled={loading}
                                className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <><Loader2 className="w-5 h-5 animate-spin mr-2" /> {t("processing")}</>
                                ) : (
                                    t("submit")
                                )}
                            </button>
                            <p className="text-[10px] text-gray-400 text-center mt-2">
                                {t("recaptchaNotice")}
                            </p>
                        </form>
                    </div>
                    <div className="bg-gray-50 p-4 border-t border-gray-100 text-center">
                        <p className="text-xs text-gray-500 font-medium">© {new Date().getFullYear()} CSCloudSolutions</p>
                    </div>
                </div>
            </div>
        </>
    );
}
