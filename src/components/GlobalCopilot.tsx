"use client";
import React, { useState, useRef } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useTranslations } from 'next-intl';
import FeatureGuard from './FeatureGuard';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';
import { hasAccess } from '@/lib/tierLogic';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';
import ReactMarkdown from 'react-markdown';

export default function GlobalCopilot() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const currentTier = (selectedTenant as any).tier || 'Essential';
    const canAccessCopilot = hasAccess(currentTier, 'Professional');
    
    const { currentPage, currentDataPayload, isOpen, setIsOpen, injectedPrompt, triggerCopilotWithPrompt } = useAIContext();
    const [messages, setMessages] = useState<{role: 'user'|'ai', content: string}[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const t = useTranslations('Copilot');
    
    // Drag state
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(true);
        dragStart.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragStart.current.x,
                y: e.clientY - dragStart.current.y
            });
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    // Security Guard moved to bottom to prevent React Hook rules violation

    const getAuthHeaders = async (): Promise<Record<string, string>> => {
        if (accounts.length === 0) return { 'Content-Type': 'application/json' };
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenResponse.idToken}`
            };
        } catch (e) {
            return { 'Content-Type': 'application/json' };
        }
    };

    React.useEffect(() => {
        if (!canAccessCopilot) return;
        const timer = setTimeout(() => {
            setIsOpen(true);
        }, 7000);
        return () => clearTimeout(timer);
    }, [setIsOpen, canAccessCopilot]);

    const handleSend = async (overridePrompt?: string) => {
        const promptText = overridePrompt || input;
        if (!promptText.trim() || loading) return;
        setMessages(prev => [...prev, { role: 'user', content: promptText }]);
        if (!overridePrompt) setInput("");
        setLoading(true);

        try {
            if (isMockTenant(selectedTenant.id)) {
                setTimeout(() => {
                    setMessages(prev => [...prev, { role: 'ai', content: "¡Claro! En este entorno de demostración puedo asistirte con simulaciones de optimización FinOps." }]);
                    setLoading(false);
                }, 1000);
                return;
            }
            const headers = await getAuthHeaders();
            const res = await fetch('/api/intelligence/copilot', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt: promptText,
                    pageContext: currentPage,
                    dataPayload: currentDataPayload,
                    tenantId: selectedTenant.id
                })
            });
            const json = await res.json();
            if (json.reply) {
                setMessages(prev => [...prev, { role: 'ai', content: json.reply }]);
            } else if (json.error) {
                setMessages(prev => [...prev, { role: 'ai', content: `⚠️ Error: ${json.details || json.error}` }]);
            }
        } catch(e: any) {
            console.error("[Copilot] Error:", e);
            setMessages(prev => [...prev, { role: 'ai', content: "⚠️ Error de conexión con el servicio de IA." }]);
        }
        setLoading(false);
    };

    React.useEffect(() => {
        if (injectedPrompt) {
            handleSend(injectedPrompt);
            triggerCopilotWithPrompt(null);
        }
    }, [injectedPrompt, triggerCopilotWithPrompt]);

    // Reset chat history when page context changes
    React.useEffect(() => {
        setMessages([]);
    }, [currentPage]);

    // Auto-fetch summary and suggestions when opened and there are no messages
    React.useEffect(() => {
        if (!isOpen || !canAccessCopilot || messages.length > 0 || !currentDataPayload || injectedPrompt) return;
        
        const fetchInitialSummary = async () => {
            setLoading(true);
            try {
                if (isMockTenant(selectedTenant.id)) {
                    const mock = getMockDataForRoute('copilot_history', selectedTenant.id);
                    if (mock?.success) {
                        setMessages((mock.history as {role: 'user'|'ai', content: string}[]) || []);
                    }
                } else {
                    const headers = await getAuthHeaders();
                    const res = await fetch('/api/intelligence/copilot', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            prompt: `Actúa como FinOps Copilot. El usuario acaba de abrir el chat en la página "${currentPage}". Redacta un saludo inicial amigable y breve (máximo 3 líneas) indicándole que ves que está en la sección de "${currentPage}". A continuación, y basándote en los datos proporcionados, dale 1 o 2 sugerencias rápidas de optimización o análisis. Responde en español y formatea tu respuesta en Markdown si es necesario.`,
                            pageContext: currentPage,
                            dataPayload: currentDataPayload,
                            tenantId: selectedTenant.id
                        })
                    });
                    const json = await res.json();
                    if (json.reply) {
                        setMessages([{ role: 'ai', content: json.reply }]);
                    } else if (json.error) {
                        setMessages([{ role: 'ai', content: `⚠️ ${json.details || json.error}` }]);
                    }
                }
            } catch(e: any) {
                console.error("[Copilot] Auto-summary error:", e);
                setMessages([{ role: 'ai', content: "⚠️ No se pudo conectar con el servicio de IA." }]);
            }
            setLoading(false);
        };
        
        fetchInitialSummary();
    }, [isOpen, currentDataPayload, currentPage, messages.length, injectedPrompt]);

    if (accounts.length === 0 || !selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    return (
        <>
            <div className="fixed bottom-6 right-6 z-50">
                <FeatureGuard requiredTier="Professional" featureName="FinOps Copilot" className="w-14 h-14">
                    <button 
                        onClick={() => { if (canAccessCopilot) setIsOpen(true); }}
                        className="w-full h-full bg-gradient-to-br from-brand-deep to-[#00AEEF] rounded-full shadow-lg flex items-center justify-center text-white hover:scale-105 transition-transform"
                    >
                        <MessageSquare className="w-6 h-6" />
                    </button>
                </FeatureGuard>
            </div>

            {isOpen && canAccessCopilot && (
                <div 
                    className={`fixed w-96 bg-surface border border-line rounded-2xl shadow-2xl z-50 flex flex-col h-[500px] overflow-hidden ${position.x === 0 && position.y === 0 ? 'bottom-24 right-6 animate-in slide-in-from-bottom-5' : ''}`}
                    style={position.x !== 0 || position.y !== 0 ? {
                        top: '50%',
                        left: '50%',
                        transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`
                    } : undefined}
                >
                    <div 
                        className="bg-brand-deep p-4 flex justify-between items-center cursor-move select-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-white" />
                            <h3 className="text-white font-bold">{t('title')}</h3>
                        </div>
                        <button 
                            onPointerDown={(e) => e.stopPropagation()} 
                            onClick={() => setIsOpen(false)} 
                            className="text-white/70 hover:text-white"
                        >
                            <X className="w-5 h-5"/>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.length === 0 && !loading && (
                            <div className="bg-surface-2 p-3 rounded-lg text-sm text-ink max-w-[85%] text-gray-500 italic">
                                Preparando contexto...
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`p-3 rounded-lg text-sm max-w-[85%] ${m.role === 'user' ? 'bg-brand text-white ml-auto' : 'bg-surface-2 text-ink mr-auto'}`}>
                                {m.role === 'user' ? (
                                    m.content
                                ) : (
                                    <div className="markdown-body text-[13px] leading-relaxed">
                                        <ReactMarkdown
                                            components={{
                                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-disc ml-5 mb-2 space-y-1" {...props} />,
                                                ol: ({node, ...props}) => <ol className="list-decimal ml-5 mb-2 space-y-1" {...props} />,
                                                li: ({node, ...props}) => <li className="pl-1" {...props} />,
                                                h3: ({node, ...props}) => <h3 className="font-bold text-[15px] mt-3 mb-1" {...props} />,
                                                h4: ({node, ...props}) => <h4 className="font-semibold text-[14px] mt-2 mb-1" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                                                code: ({node, ...props}) => {
                                                    const isInline = !props.className;
                                                    return isInline ? (
                                                        <code className="bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded text-[13px] font-mono" {...props} />
                                                    ) : (
                                                        <pre className="bg-black/5 dark:bg-white/10 p-2 rounded-lg my-2 overflow-x-auto text-[12px] font-mono"><code {...props} /></pre>
                                                    );
                                                }
                                            }}
                                        >
                                            {m.content}
                                        </ReactMarkdown>
                                    </div>
                                )}
                            </div>
                        ))}
                        {loading && <div className="text-sm text-ink-soft flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2"/> Thinking...</div>}
                    </div>

                    <div className="p-3 border-t border-line bg-surface flex gap-2">
                        <input 
                            type="text" 
                            className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm outline-none placeholder-ink-soft"
                            placeholder={t('placeholder')}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSend()}
                        />
                        <button onClick={() => handleSend()} disabled={loading} className="p-2 bg-brand text-white rounded-lg"><Send className="w-4 h-4"/></button>
                    </div>
                </div>
            )}
        </>
    );
}
