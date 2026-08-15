"use client";
import React, { useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useTranslations, useLocale } from 'next-intl';
import { useTenant } from './TenantProvider';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { hasAccess } from '@/lib/tierLogic';
import { compactPayloadString } from '@/lib/copilotPayload';
import { captureAutoPageSnapshot, deriveLabelFromPathname } from '@/lib/autoPageContext';
import { isMockTenant } from '@/lib/mockData';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchWithAuthRetry } from '@/lib/msalToken';

/** Nombre por defecto de `useAIContext` cuando ninguna página llamó a
 *  `setPageContext` — usado para saber cuándo pisarlo con la etiqueta
 *  derivada automáticamente del pathname. */
const DEFAULT_PAGE_LABEL = 'Dashboard';

export default function GlobalCopilot() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isMsalAuthenticated = useIsAuthenticated();
    const currentTier = (selectedTenant as any).tier || 'Professional';
    // FinOps Copilot (IA) es feature Professional (ver pricing.pro.features).
    const canAccessCopilot = hasAccess(currentTier, 'Professional');
    
    const { currentPage, currentDataPayload, isOpen, setIsOpen, injectedPrompt, triggerCopilotWithPrompt } = useAIContext();
    const [messages, setMessages] = useState<{role: 'user'|'ai', content: string}[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [quota, setQuota] = useState<{ limit: number|null, remaining: number|null } | null>(null);
    const t = useTranslations('Copilot');
    const locale = useLocale();
    const pathname = usePathname();

    // La página de login del demo (/es/demo, /en/demo, /pt-BR/demo, ...) es
    // pre-autenticación: el Copilot nunca debe aparecer ahí. Un tenant mock
    // que quedó en localStorage de una sesión demo previa hace que
    // isMockTenant() sea true, lo cual (sin este check) burlaba el
    // early-return de abajo y auto-abría el Copilot sobre el formulario de
    // login del demo. El demo YA autenticado redirige a "/" (ver
    // setDemoSession), nunca a "/demo", así que acotar por esta ruta es seguro.
    const isDemoLoginRoute = /^\/[^/]+\/demo(\/|$)/.test(pathname || '');

    // Fallback automático: si la página activa nunca llamó a
    // `setPageContext` (la gran mayoría no lo hace), capturamos su contenido
    // renderizado desde el DOM (<main>) para que el Copilot pueda leerla y
    // generar el reporte igual, sin wiring manual por página.
    const [autoPayload, setAutoPayload] = useState<string | null>(null);
    const [autoPageLabel, setAutoPageLabel] = useState<string | null>(null);
    // El auto-reporte espera a que la captura automática "asiente" (páginas
    // con fetch async al montar pueden tardar en pintar datos reales) antes
    // de dispararse — si no, el primer reporte podría analizar solo
    // skeletons/loaders. El contexto manual (`currentDataPayload`) ya trae
    // datos completos de entrada, así que ese camino no espera.
    const [autoContentSettled, setAutoContentSettled] = useState(false);
    const effectiveDataPayload = currentDataPayload ?? autoPayload;
    const effectivePageLabel = (currentPage && currentPage !== DEFAULT_PAGE_LABEL)
        ? currentPage
        : (autoPageLabel || currentPage);

    React.useEffect(() => {
        if (!isOpen || currentDataPayload) return; // ya hay contexto manual real, no lo pisamos
        setAutoPayload(null);
        setAutoPageLabel(deriveLabelFromPathname(pathname));
        setAutoContentSettled(false);

        // La página puede seguir cargando datos async (fetch al montar) — se
        // reintenta la captura para no quedarnos con un snapshot vacío o de
        // solo skeletons/loaders. Se marca "settled" recién después del
        // último intento, para no disparar el auto-reporte con datos a medio
        // cargar.
        const captureDelays = [800, 2200];
        const attempts = captureDelays.map((delay) =>
            setTimeout(() => {
                const snapshot = captureAutoPageSnapshot();
                if (snapshot) {
                    setAutoPayload((prev) => (snapshot.length > (prev?.length || 0) ? snapshot : prev));
                }
            }, delay)
        );
        const settledTimer = setTimeout(() => setAutoContentSettled(true), Math.max(...captureDelays) + 300);
        return () => { attempts.forEach(clearTimeout); clearTimeout(settledTimer); };
    }, [isOpen, pathname, currentDataPayload]);
    
    // Drag state
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [fabPosition, setFabPosition] = useState<{ x: number; y: number } | null>(null);
    const [size, setSize] = useState({ width: 460, height: 620 });
    const [isDragging, setIsDragging] = useState(false);
    const [isFabDragging, setIsFabDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const fabDragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
    const didDragFab = useRef(false);
    const resizeDirection = useRef<'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'>('se');
    const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });

    React.useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const savedWindowPos = localStorage.getItem("copilot_window_position");
            const savedFabPos = localStorage.getItem("copilot_fab_position");
            if (savedWindowPos) {
                const parsed = JSON.parse(savedWindowPos);
                const maxX = Math.max(16, window.innerWidth - 460 - 16);
                const maxY = Math.max(16, window.innerHeight - 620 - 16);
                setPosition({ x: Math.min(Math.max(16, parsed.x), maxX), y: Math.min(Math.max(16, parsed.y), maxY) });
            } else {
                setPosition({ x: Math.max(16, window.innerWidth - 460 - 24), y: Math.max(16, window.innerHeight - 620 - 96) });
            }

            if (savedFabPos) {
                const parsed = JSON.parse(savedFabPos);
                const maxX = Math.max(16, window.innerWidth - 64 - 16);
                const maxY = Math.max(16, window.innerHeight - 64 - 16);
                setFabPosition({ x: Math.min(Math.max(16, parsed.x), maxX), y: Math.min(Math.max(16, parsed.y), maxY) });
            } else {
                setFabPosition({ x: Math.max(16, window.innerWidth - 64 - 24), y: Math.max(16, window.innerHeight - 64 - 24) });
            }
        } catch {
            setPosition({ x: 24, y: 24 });
            setFabPosition({ x: 24, y: 24 });
        }
    }, []);

    // Re-clamp positions on browser zoom (Cmd - / Cmd 0) or window resize
    React.useEffect(() => {
        const handleResize = () => {
            setPosition((prev) => {
                if (!prev) return null;
                const maxX = Math.max(16, window.innerWidth - size.width - 16);
                const maxY = Math.max(16, window.innerHeight - size.height - 16);
                return {
                    x: Math.min(Math.max(16, prev.x), maxX),
                    y: Math.min(Math.max(16, prev.y), maxY),
                };
            });
            setFabPosition((prev) => {
                if (!prev) return null;
                const maxX = Math.max(16, window.innerWidth - 72);
                const maxY = Math.max(16, window.innerHeight - 72);
                return {
                    x: Math.min(Math.max(16, prev.x), maxX),
                    y: Math.min(Math.max(16, prev.y), maxY),
                };
            });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [size.width, size.height]);

    React.useEffect(() => {
        if (!position || typeof window === "undefined") return;
        localStorage.setItem("copilot_window_position", JSON.stringify(position));
    }, [position]);

    React.useEffect(() => {
        if (!fabPosition || typeof window === "undefined") return;
        localStorage.setItem("copilot_fab_position", JSON.stringify(fabPosition));
    }, [fabPosition]);

    const openCopilot = () => {
        if (!canAccessCopilot) return;
        setPosition((prev) => {
            const posX = prev ? prev.x : window.innerWidth - size.width - 24;
            const posY = prev ? prev.y : window.innerHeight - size.height - 96;
            const maxX = Math.max(16, window.innerWidth - size.width - 16);
            const maxY = Math.max(16, window.innerHeight - size.height - 16);
            return {
                x: Math.min(Math.max(16, posX), maxX),
                y: Math.min(Math.max(16, posY), maxY),
            };
        });
        setIsOpen(true);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!position) return;
        setIsDragging(true);
        dragStart.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (isDragging && position) {
            const nextX = e.clientX - dragStart.current.x;
            const nextY = e.clientY - dragStart.current.y;
            const maxX = Math.max(0, window.innerWidth - size.width);
            const maxY = Math.max(0, window.innerHeight - size.height);
            setPosition({
                x: Math.min(Math.max(0, nextX), maxX),
                y: Math.min(Math.max(0, nextY), maxY),
            });
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleFabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!fabPosition) return;
        setIsFabDragging(true);
        didDragFab.current = false;
        fabDragStart.current = { x: e.clientX, y: e.clientY, startX: fabPosition.x, startY: fabPosition.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handleFabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isFabDragging || !fabPosition) return;
        const dx = e.clientX - fabDragStart.current.x;
        const dy = e.clientY - fabDragStart.current.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) didDragFab.current = true;
        const nextX = fabDragStart.current.startX + dx;
        const nextY = fabDragStart.current.startY + dy;
        const maxX = Math.max(0, window.innerWidth - 64);
        const maxY = Math.max(0, window.innerHeight - 64);
        setFabPosition({
            x: Math.min(Math.max(0, nextX), maxX),
            y: Math.min(Math.max(0, nextY), maxY),
        });
    };

    const handleFabPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsFabDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (!didDragFab.current && canAccessCopilot) {
            openCopilot();
        }
    };

    const handleResizeDown = (direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => (e: React.PointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!position) return;
        resizeDirection.current = direction;
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
        if (isResizing && position) {
            e.stopPropagation();
            const dx = e.clientX - resizeStart.current.x;
            const dy = e.clientY - resizeStart.current.y;
            const dir = resizeDirection.current;
            const minWidth = 320;
            const minHeight = 400;
            let newX = resizeStart.current.posX;
            let newY = resizeStart.current.posY;
            let newWidth = resizeStart.current.width;
            let newHeight = resizeStart.current.height;

            if (dir.includes('e')) {
                const maxWidth = Math.max(minWidth, window.innerWidth - resizeStart.current.posX);
                newWidth = Math.min(Math.max(minWidth, resizeStart.current.width + dx), maxWidth);
            }
            if (dir.includes('s')) {
                const maxHeight = Math.max(minHeight, window.innerHeight - resizeStart.current.posY);
                newHeight = Math.min(Math.max(minHeight, resizeStart.current.height + dy), maxHeight);
            }
            if (dir.includes('w')) {
                const maxWidth = resizeStart.current.posX + resizeStart.current.width;
                const candidateWidth = resizeStart.current.width - dx;
                newWidth = Math.min(Math.max(minWidth, candidateWidth), maxWidth);
                newX = resizeStart.current.posX + (resizeStart.current.width - newWidth);
            }
            if (dir.includes('n')) {
                const maxHeight = resizeStart.current.posY + resizeStart.current.height;
                const candidateHeight = resizeStart.current.height - dy;
                newHeight = Math.min(Math.max(minHeight, candidateHeight), maxHeight);
                newY = resizeStart.current.posY + (resizeStart.current.height - newHeight);
            }

            setSize({ width: newWidth, height: newHeight });
            setPosition({ x: newX, y: newY });
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
        if (!canAccessCopilot || isDemoLoginRoute) return;
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
    }, [setIsOpen, canAccessCopilot, isDemoLoginRoute]);

    React.useEffect(() => {
        if (isOpen && canAccessCopilot && selectedTenant?.id && selectedTenant.id !== 'default') {
            const account = accounts[0] || null;
            const doFetch = isMockTenant(selectedTenant.id)
                ? fetch(`/api/intelligence/copilot/quota?tenantId=${selectedTenant.id}`)
                : fetchWithAuthRetry(instance, account, `/api/intelligence/copilot/quota?tenantId=${selectedTenant.id}`);
                
            doFetch
                .then(r => r.json())
                .then(data => {
                    if (data.monthly) setQuota(data.monthly);
                })
                .catch(e => console.error("[Copilot Quota] Failed to load quota", e));
        }
    }, [isOpen, canAccessCopilot, selectedTenant?.id, instance, accounts]);

    const handleSend = async (overridePrompt?: string, displayText?: string) => {
        const promptText = overridePrompt || input;
        if (!promptText.trim() || loading) return;
        // `displayText` permite enviar un prompt largo/técnico al modelo (ej. el
        // template de auto-reporte) sin mostrar esa instrucción cruda en el chat:
        // la burbuja del usuario muestra una etiqueta amigable en su lugar.
        setMessages(prev => [...prev, { role: 'user', content: displayText || promptText }]);
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
            // `effectiveDataPayload` cae al snapshot automático del DOM cuando la
            // página no cableó `setPageContext` manualmente (ver efecto arriba).
            const compactedPayload = typeof effectiveDataPayload === 'string'
                ? effectiveDataPayload
                : compactPayloadString(effectiveDataPayload);
            // Timeout duro en el cliente: sin esto, si el proveedor de IA se
            // cuelga (rate limit del free tier, etc.) el usuario ve el spinner
            // girar indefinidamente sin ningún feedback ("tarda mucho / no
            // funciona"). El backend ya corta a los 25s (ver abortSignal en
            // route.ts) — 30s acá da margen y siempre termina en un error visible.
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 30_000);
            
            const account = accounts[0] || null;
            const doFetch = (url: string, opts: any) => isMockTenant(selectedTenant?.id || '') 
                ? fetch(url, opts)
                : fetchWithAuthRetry(instance, account, url, opts);

            const res = await doFetch('/api/intelligence/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abortController.signal,
                body: JSON.stringify({
                    prompt: promptText,
                    pageContext: effectivePageLabel,
                    dataPayload: compactedPayload,
                    tenantId: selectedTenant.id,
                    locale
                })
            }).finally(() => clearTimeout(timeoutId));

            // Errores (no streaming): el backend devuelve JSON con error.
            if (!res.ok || !res.body) {
                let detail = `HTTP ${res.status}`;
                let quotaExceeded = false;
                try {
                    const json = await res.json();
                    detail = json.details || json.error || detail;
                    quotaExceeded = json.quotaExceeded === true;
                } catch (_) {}
                // Cuota mensual agotada: no es un error del sistema (nada está
                // roto), así que se muestra como aviso informativo en vez de con
                // el prefijo "⚠️ Error:" que sugeriría una falla técnica.
                const content = quotaExceeded ? `ℹ️ ${detail}` : `⚠️ Error: ${detail}`;
                setMessages(prev => [...prev, { role: 'ai', content }]);
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
                // El proveedor de IA puede fallar DESPUÉS de que el stream ya
                // empezó (rate limit, timeout) — en modo text/plain esto no viaja
                // como un error estructurado, el stream simplemente se corta sin
                // contenido. Antes esto dejaba la burbuja vacía sin ninguna
                // explicación (el bug reportado como "no funciona").
                if (!acc.trim()) {
                    acc = "⚠️ El asistente no pudo generar una respuesta (el servicio de IA puede estar saturado). Probá de nuevo en unos segundos.";
                }
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
            const errorText = e?.name === 'AbortError'
                ? "⚠️ El asistente tardó demasiado en responder. Probá de nuevo."
                : "⚠️ Error de conexión con el servicio de IA.";
            // Si ya se había insertado la burbuja placeholder (vacía) antes de que
            // el error ocurriera durante la lectura del stream, la reemplaza en
            // vez de agregar una segunda burbuja de error.
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'ai' && last.content === '') {
                    const copy = [...prev];
                    copy[copy.length - 1] = { role: 'ai', content: errorText };
                    return copy;
                }
                return [...prev, { role: 'ai', content: errorText }];
            });
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
    }, [currentPage, pathname]);

    // Directiva: nunca autogenerar reporte ejecutivo al abrir el Copilot.
    // El análisis debe iniciar solo por solicitud explícita del usuario.

    // Página de login del demo: pre-auth, sin Copilot (ver isDemoLoginRoute arriba).
    if (isDemoLoginRoute) {
        return null;
    }

    // El demo público (/demo) es 100% anónimo — nunca hay cuenta MSAL, así que
    // se lo admite explícitamente por tenant mock en vez de por sesión.
    const isDemoTenant = isMockTenant(selectedTenant?.id || '');

    // Sesión iniciada Y validada. `accounts.length > 0` solo dice que MSAL tiene
    // una cuenta en cache: sobrevive a un token vencido y es true durante el
    // handshake. useIsAuthenticated() es la señal de que la sesión quedó
    // establecida. Se exigen las dos, más un tenant resuelto (`default` es el
    // placeholder previo a que TenantProvider responda).
    const hasValidatedSession = (isMsalAuthenticated && accounts.length > 0) || isDemoTenant;
    if (!hasValidatedSession || !selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    // Tier: se OCULTA, no se desenfoca. Antes esto lo resolvía FeatureGuard, que
    // renderiza al hijo borroso y clickeable — así que con un tier insuficiente
    // la burbuja seguía apareciendo flotando sobre la app y al hacer click no
    // abría nada (el onClick ya chequeaba canAccessCopilot). Un asistente que
    // está pero no responde es peor que no estar.
    if (!canAccessCopilot) {
        return null;
    }

    const resizeHandles: Array<{
        direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
        className: string;
    }> = [
        { direction: 'n', className: 'top-0 left-3 right-3 h-2 -translate-y-1 cursor-n-resize' },
        { direction: 's', className: 'bottom-0 left-3 right-3 h-2 translate-y-1 cursor-s-resize' },
        { direction: 'e', className: 'right-0 top-3 bottom-3 w-2 translate-x-1 cursor-e-resize' },
        { direction: 'w', className: 'left-0 top-3 bottom-3 w-2 -translate-x-1 cursor-w-resize' },
        { direction: 'ne', className: 'top-0 right-0 h-4 w-4 translate-x-1 -translate-y-1 cursor-ne-resize' },
        { direction: 'nw', className: 'top-0 left-0 h-4 w-4 -translate-x-1 -translate-y-1 cursor-nw-resize' },
        { direction: 'se', className: 'bottom-0 right-0 h-4 w-4 translate-x-1 translate-y-1 cursor-se-resize' },
        { direction: 'sw', className: 'bottom-0 left-0 h-4 w-4 -translate-x-1 translate-y-1 cursor-sw-resize' },
    ];

    return (
        <>
            <div
                className="fixed z-50 touch-none"
                style={fabPosition ? { left: fabPosition.x, top: fabPosition.y } : { right: 24, bottom: 24 }}
                onPointerDown={handleFabPointerDown}
                onPointerMove={handleFabPointerMove}
                onPointerUp={handleFabPointerUp}
                onPointerCancel={handleFabPointerUp}
            >
                <div className="w-16 h-16">
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
                            type="button"
                            aria-label={t('tooltip')}
                            onClick={(e) => {
                                e.stopPropagation();
                                openCopilot();
                            }}
                            className="relative w-full h-full bg-gradient-to-br from-[#0E1A2B] to-[#00AEEF] rounded-full shadow-lg flex items-center justify-center text-white hover:scale-110 transition-transform cursor-pointer"
                        >
                            <MessageSquare className="w-7 h-7 !text-white" />
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
                </div>
            </div>

            {isOpen && canAccessCopilot && (
                <div 
                    className="fixed bg-surface border border-line rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
                    style={{
                        ...(position ? { left: position.x, top: position.y } : { right: 24, bottom: 96 }),
                        width: `${size.width}px`,
                        height: `${size.height}px`,
                    }}
                >
                    <div 
                        className="bg-[#0E1A2B] p-4 flex justify-between items-center cursor-move select-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 !text-white" />
                            <h3 className="text-white font-bold">{t('title')}</h3>
                            {quota && (
                                <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/90">
                                    {quota.limit === null 
                                        ? t('quota_unlimited')
                                        : t('quota_used', { remaining: quota.remaining as number, limit: quota.limit as number })}
                                </span>
                            )}
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
                            <div key={i} className={`p-3 rounded-lg text-sm max-w-[85%] ${m.role === 'user' ? 'bg-[#0E1A2B] text-white ml-auto' : 'bg-surface-2 text-ink mr-auto'}`}>
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
                                                // mt-4 (en vez de mt-3) + borde superior sutil: separa visualmente cada
                                                // sección del reporte cuando hay varios headings seguidos — evita que
                                                // se lea como un bloque de texto continuo.
                                                h3: ({node, ...props}) => <h3 className="font-bold text-[15px] mt-4 mb-1.5 pt-2 border-t border-line first:mt-0 first:pt-0 first:border-t-0" {...props} />,
                                                h4: ({node, ...props}) => <h4 className="font-semibold text-[14px] mt-2 mb-1" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold text-[#0E1A2B] dark:text-brand-bright" {...props} />,
                                                // El prompt del sistema usa "---" para separar secciones cuando no
                                                // corresponde un heading nuevo (ej. el CTA final del auto-reporte).
                                                hr: ({node, ...props}) => <hr className="my-3 border-line" {...props} />,
                                                em: ({node, ...props}) => <em className="text-ink-soft" {...props} />,
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
                        {loading && <div className="text-sm text-ink-soft flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2"/> Analizando datos de {effectivePageLabel}…</div>}
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
                        <button onClick={() => handleSend()} disabled={loading} className="p-2 bg-[#0E1A2B] text-white rounded-lg hover:bg-brand-bright transition-colors disabled:opacity-50"><Send className="w-4 h-4"/></button>
                        
                    </div>

                    {resizeHandles.map((handle) => (
                        <div
                            key={handle.direction}
                            className={`absolute touch-none z-10 ${handle.className}`}
                            onPointerDown={handleResizeDown(handle.direction)}
                            onPointerMove={handleResizeMove}
                            onPointerUp={handleResizeUp}
                            onPointerCancel={handleResizeUp}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
