"use client";
import React, { useState } from 'react';
import Script from 'next/script';
import { Loader2 } from 'lucide-react';

interface DemoLeadModalProps {
    onSuccess: () => void;
    /** Si se provee, muestra una X para cerrar el modal sin completar (p.ej. en la página de precios). */
    onClose?: () => void;
}

declare global {
    interface Window {
        grecaptcha: any;
    }
}

export default function DemoLeadModal({ onSuccess, onClose }: DemoLeadModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        phone: '',
        companyName: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (!window.grecaptcha) {
            setError('Error cargando reCAPTCHA. Por favor, recarga la página.');
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
                    setError(data.error || 'Ocurrió un error. Por favor, intenta de nuevo.');
                }
            } catch (err) {
                console.error(err);
                setError('Error al procesar la solicitud.');
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
            />
            <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300 relative">
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Cerrar"
                            className="absolute top-3 right-3 z-10 p-1.5 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    )}
                    <div className="p-8">
                        <div className="text-center mb-6">
                            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Acceso a la Demo</h2>
                            <p className="text-sm text-gray-500 mt-2">Por favor, completa tus datos para acceder a la demostración de FinOps SaaS.</p>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre Completo</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder="Ej. Juan Pérez" 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white"
                                    value={formData.fullName}
                                    onChange={e => setFormData({...formData, fullName: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Correo Electrónico</label>
                                <input 
                                    type="email" 
                                    required 
                                    placeholder="Ej. juan@empresa.com" 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white"
                                    value={formData.email}
                                    onChange={e => setFormData({...formData, email: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Teléfono</label>
                                <input 
                                    type="tel" 
                                    required 
                                    placeholder="Ej. +54 11 1234-5678" 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white"
                                    value={formData.phone}
                                    onChange={e => setFormData({...formData, phone: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre empresa</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder="Ej. CSCloudSolutions S.A." 
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all text-gray-900 bg-white"
                                    value={formData.companyName}
                                    onChange={e => setFormData({...formData, companyName: e.target.value})}
                                />
                            </div>

                            {error && (
                                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                                    {error}
                                </div>
                            )}

                            <button 
                                type="submit" 
                                disabled={loading}
                                className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Procesando...</>
                                ) : (
                                    "Acceder a la Demo"
                                )}
                            </button>
                            <p className="text-[10px] text-gray-400 text-center mt-2">
                                Este sitio está protegido por reCAPTCHA y se aplican la Política de privacidad y los Términos de servicio de Google.
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
