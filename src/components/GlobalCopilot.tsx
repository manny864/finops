"use client";
import React, { useState, useRef } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useTranslations, useLocale } from 'next-intl';
import FeatureGuard from './FeatureGuard';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';
import { hasAccess } from '@/lib/tierLogic';
import { compactPayloadString } from '@/lib/copilotPayload';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function GlobalCopilot() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const currentTier = (selectedTenant as any).tier || 'Essential';
    // FinOps Copilot (IA) es feature Business (ver pricing.business.features),
    // no Professional.
    const canAccessCopilot = hasAccess(currentTier, 'Business');
    
    const { currentPage, currentDataPayload, isOpen, setIsOpen, injectedPrompt, triggerCopilotWithPrompt } = useAIContext();
    const [messages, setMessages] = useState<{role: 'user'|'ai', content: string}[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const t = useTranslations('Copilot');
    const locale = useLocale();
    
    // Drag state
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [size, setSize] = useState({ width: 460, height: 620 });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });

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

    const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        setIsResizing(true);
        resizeStart.current = {
            x: e.clientX,
            y: e.clientY,
            width: size.width,
            height: size.height,
            posX: position.x,
            posY: position.y
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (isResizing) {
            e.stopPropagation();
            const dx = e.clientX - resizeStart.current.x;
            const dy = e.clientY - resizeStart.current.y;
            const newWidth = Math.max(320, resizeStart.current.width + dx);
            const newHeight = Math.max(400, resizeStart.current.height + dy);
            
            const actualDx = newWidth - resizeStart.current.width;
            const actualDy = newHeight - resizeStart.current.height;
            
            setSize({ width: newWidth, height: newHeight });
            
            // Si la ventana ya fue movida (centrada con offset), ajustamos el offset
            // para que la esquina superior izquierda se quede quieta durante el redimensionado.
            if (position.x !== 0 || position.y !== 0) {
                setPosition({
                    x: resizeStart.current.posX + actualDx / 2,
                    y: resizeStart.current.posY + actualDy / 2
                });
            }
        }
    };

    const handleResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (isResizing) {
            e.stopPropagation();
            setIsResizing(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
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
        // Mostrar UNA SOLA VEZ por sesión: si el usuario lo minimiza, queda así
        // hasta que reabra manualmente o inicie nueva sesión.
        try {
            const shown = sessionStorage.getItem('copilot_shown_session');
            if (!shown) {
                setIsOpen(true);
                sessionStorage.setItem('copilot_shown_session', '1');
            }
        } catch {
            // sessionStorage no disponible (SSR/privacy mode): no auto-abrir
        }
    }, [setIsOpen, canAccessCopilot]);

    const handleSend = async (overridePrompt?: string) => {
        const promptText = overridePrompt || input;
        if (!promptText.trim() || loading) return;
        setMessages(prev => [...prev, { role: 'user', content: promptText }]);
        if (!overridePrompt) setInput("");
        setLoading(true);

        try {
            // DEMO tenants pasan por el mismo flujo de API: los datos mock
            // que cargó la página activa están en `currentDataPayload`, así que
            // Gemini puede analizarlos igual que datos reales. La ruta backend
            // permite explícitamente los IDs DEMO.
            const headers = await getAuthHeaders();
            // Compactamos el payload: en vez de mandar un array crudo de cientos
            // de filas truncado, mandamos un resumen estructurado (totales,
            // top-N, conteos). Menos tokens de entrada => primer token más rápido.
            const compactedPayload = compactPayloadString(currentDataPayload);
            const res = await fetch('/api/intelligence/copilot', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt: promptText,
                    pageContext: currentPage,
                    dataPayload: compactedPayload,
                    tenantId: selectedTenant.id,
                    locale
                })
            });

            // Errores (no streaming): el backend devuelve JSON con error.
            if (!res.ok || !res.body) {
                let detail = `HTTP ${res.status}`;
                try {
                    const json = await res.json();
                    detail = json.details || json.error || detail;
                } catch (_) {}
                setMessages(prev => [...prev, { role: 'ai', content: `⚠️ Error: ${detail}` }]);
                setLoading(false);
                return;
            }

            // Si el backend respondió con text/plain (stream) lo consumimos token a token.
            const contentType = res.headers.get('content-type') || '';
            if (contentType.startsWith('text/plain')) {
                // Placeholder para que la UI muestre la burbuja vacía y se vaya rellenando.
                setMessages(prev => [...prev, { role: 'ai', content: '' }]);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let acc = '';
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    acc += decoder.decode(value, { stream: true });
                    setMessages(prev => {
                        const copy = [...prev];
                        copy[copy.length - 1] = { role: 'ai', content: acc };
                        return copy;
                    });
                }
                // flush final
                acc += decoder.decode();
                setMessages(prev => {
                    const copy = [...prev];
                    copy[copy.length - 1] = { role: 'ai', content: acc };
                    return copy;
                });
            } else {
                // Fallback compatible con la respuesta JSON previa.
                const json = await res.json();
                if (json.reply) {
                    setMessages(prev => [...prev, { role: 'ai', content: json.reply }]);
                } else if (json.error) {
                    setMessages(prev => [...prev, { role: 'ai', content: `⚠️ Error: ${json.details || json.error}` }]);
                }
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

    // Auto-reporte al abrir: dispara automáticamente un análisis de la página
    // activa en streaming. Reemplaza el saludo estático anterior — el usuario
    // ve el reporte materializándose token a token sin tener que escribir.
    // Tenants DEMO siguen el mismo flujo: tienen dataPayload sintético cargado
    // y el backend acepta el análisis sobre estos IDs de prueba.
    React.useEffect(() => {
        if (!isOpen || !canAccessCopilot || messages.length > 0 || !currentDataPayload || injectedPrompt) return;

        // Dispara el reporte ejecutivo en streaming. Aspiramos a un documento
        // accionable que el usuario pueda usar para tomar decisiones reales:
        // contexto, hallazgos cuantificados, ahorros priorizados, riesgos y
        // próximos pasos con responsable/esfuerzo estimado.
        handleSend(
            `Generá un **REPORTE EJECUTIVO DETALLADO** del módulo "${currentPage}" basado estrictamente en los datos provistos en el contexto. ` +
            `Debe servirle a un decisor (CFO/Cloud Lead/FinOps) para tomar acción esta semana. Usá Markdown con esta estructura EXACTA:\n\n` +
            `### 🎯 Contexto del módulo\n` +
            `1 párrafo (3-4 líneas) explicando qué se está analizando, alcance (suscripciones/recursos cubiertos) y la "lectura general" del estado actual.\n\n` +
            `### 📊 Hallazgos clave\n` +
            `Tabla Markdown con las 5-8 métricas/insights más relevantes del payload. Columnas: **Métrica | Valor actual | Benchmark/Esperado | Variación | Implicancia**.\n\n` +
            `### 💰 Oportunidades de optimización\n` +
            `Lista priorizada (top 5) en formato:\n` +
            `- **#1 [Nombre]** — Ahorro estimado: **$X/mes** · Esfuerzo: bajo/medio/alto · Riesgo: bajo/medio/alto\n` +
            `  - Hallazgo concreto (cifras del payload)\n` +
            `  - Acción recomendada (1 línea ejecutable)\n` +
            `Sumá el total al final: **Ahorro mensual potencial total: $X · Anualizado: $Y**.\n\n` +
            `### ⚠️ Riesgos y alertas\n` +
            `Bullets con riesgos detectados (HA, gobierno, compliance, sobre-aprovisionamiento). Si no hay → "Sin riesgos críticos detectados".\n\n` +
            `### 🚀 Plan de acción (próximos 7 días)\n` +
            `Checklist numerado de 3-5 pasos concretos. Cada paso: qué hacer, quién (rol) y resultado esperado.\n\n` +
            `### 📈 Métricas a monitorear\n` +
            `2-4 KPIs específicos con valores objetivo para la próxima revisión.\n\n` +
            `**Reglas estrictas**:\n` +
            `- Cifras SIEMPRE del payload (USD, %, conteos). NUNCA inventes valores.\n` +
            `- Si un dato falta, escribí "n/d" y aclarálo en Riesgos.\n` +
            `- Sé concreto: nada de "considerar revisar"; usá verbos accionables (eliminar, redimensionar, migrar, programar apagado).\n` +
            `- Extensión objetivo: 600-900 palabras. Profesional, ejecutivo, sin relleno.`
        );
    }, [isOpen, currentDataPayload, currentPage, messages.length, injectedPrompt]);

    if (accounts.length === 0 || !selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    return (
        <>
            <div className="fixed bottom-6 right-6 z-50">
                <FeatureGuard requiredTier="Business" featureName="FinOps Copilot" className="w-16 h-16">
                    <div className="relative group w-full h-full">
                        {/* Halo animado periódico para llamar la atención */}
                        {!isOpen && (
                            <>
                                <span
                                    aria-hidden
                                    className="absolute inset-0 rounded-full bg-[#00AEEF] opacity-60 animate-copilot-ping pointer-events-none"
                                />
                                <span
                                    aria-hidden
                                    className="absolute inset-0 rounded-full ring-2 ring-[#00AEEF]/40 animate-copilot-pulse pointer-events-none"
                                />
                            </>
                        )}
                        <button
                            onClick={() => { if (canAccessCopilot) setIsOpen(true); }}
                            aria-label={t('tooltip')}
                            className="relative w-full h-full bg-gradient-to-br from-brand-deep to-[#00AEEF] rounded-full shadow-lg flex items-center justify-center text-white hover:scale-110 transition-transform"
                        >
                            <MessageSquare className="w-7 h-7" />
                        </button>
                        {/* Tooltip al hover */}
                        <div
                            role="tooltip"
                            className="pointer-events-none absolute bottom-full right-0 mb-3 w-64 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs leading-snug shadow-xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200"
                        >
                            {t('tooltip')}
                            <span className="absolute -bottom-1 right-6 w-2 h-2 bg-slate-900 rotate-45" />
                        </div>
                    </div>
                </FeatureGuard>
            </div>

            {isOpen && canAccessCopilot && (
                <div 
                    className={`fixed bg-surface border border-line rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden ${position.x === 0 && position.y === 0 ? 'bottom-24 right-6 animate-in slide-in-from-bottom-5' : ''}`}
                    style={{
                        ...(position.x !== 0 || position.y !== 0 ? {
                            top: '50%',
                            left: '50%',
                            transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`
                        } : {}),
                        width: `${size.width}px`,
                        height: `${size.height}px`
                    }}
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
                            <div className="bg-surface-2 p-3 rounded-lg text-sm text-ink-soft max-w-[85%] italic">
                                Esperando datos de la página…
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`p-3 rounded-lg text-sm max-w-[85%] ${m.role === 'user' ? 'bg-brand-deep text-white ml-auto' : 'bg-surface-2 text-ink mr-auto'}`}>
                                {m.role === 'user' ? (
                                    m.content
                                ) : (
                                    <div className="markdown-body text-[13px] leading-relaxed">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-disc ml-5 mb-2 space-y-1" {...props} />,
                                                ol: ({node, ...props}) => <ol className="list-decimal ml-5 mb-2 space-y-1" {...props} />,
                                                li: ({node, ...props}) => <li className="pl-1" {...props} />,
                                                h3: ({node, ...props}) => <h3 className="font-bold text-[15px] mt-3 mb-1" {...props} />,
                                                h4: ({node, ...props}) => <h4 className="font-semibold text-[14px] mt-2 mb-1" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                                                table: ({node, ...props}) => <div className="overflow-x-auto my-2"><table className="min-w-full text-[12px] border-collapse" {...props} /></div>,
                                                thead: ({node, ...props}) => <thead className="bg-surface-2" {...props} />,
                                                th: ({node, ...props}) => <th className="border border-line px-2 py-1 text-left font-semibold" {...props} />,
                                                td: ({node, ...props}) => <td className="border border-line px-2 py-1 align-top" {...props} />,
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
                        {loading && <div className="text-sm text-ink-soft flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2"/> Analizando datos de {currentPage}…</div>}
                    </div>

                    <div className="p-3 border-t border-line bg-surface flex gap-2 relative">
                        <input 
                            type="text" 
                            className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none placeholder-ink-soft"
                            placeholder={t('placeholder')}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSend()}
                        />
                        <button onClick={() => handleSend()} disabled={loading} className="p-2 bg-brand-deep text-white rounded-lg hover:bg-brand-bright transition-colors disabled:opacity-50"><Send className="w-4 h-4"/></button>
                        
                        {/* Custom Resize Handle */}
                        <div 
                            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1 opacity-50 hover:opacity-100 touch-none"
                            onPointerDown={handleResizeDown}
                            onPointerMove={handleResizeMove}
                            onPointerUp={handleResizeUp}
                            onPointerCancel={handleResizeUp}
                        >
                            <div className="w-2 h-2 border-r-2 border-b-2 border-brand-deep rounded-br-sm" />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
