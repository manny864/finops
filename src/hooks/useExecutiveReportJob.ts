'use client';
/**
 * useExecutiveReportJob.ts — Hook reactivo para orquestación y seguimiento de tareas asíncronas
 * de compilación de Reportes Ejecutivos FinOps.
 *
 * Características:
 *   - Polling desacoplado cada 3 segundos.
 *   - Persistencia de `activeReportJobId_${tenantId}` en sessionStorage para reanudar el progreso al navegar.
 *   - Doble sistema de notificación al finalizar: HTML5 Web Notifications API + Centro de Acciones In-App.
 *   - Manejo de estados: QUEUED -> COLLECTING_METRICS -> AI_SYNTHESIZING -> COMPILING_PDF -> COMPLETED / FAILED.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';
import { useActionLogStore } from '@/store/actionLogStore';
import { requestNotificationPermission } from '@/hooks/useBrowserNotifications';
import type {
    JobStatusResponse,
    ReportJobStep,
    StartReportJobPayload,
} from '@/types/executiveReportJob.types';
import type { ExecutiveReportData } from '@/types/executiveReport.types';
import toast from 'react-hot-toast';

const POLL_INTERVAL_MS = 3000;
const STORAGE_PREFIX = 'activeReportJobId_';

export interface UseExecutiveReportJobOptions {
    tenantId?: string;
    organizationName?: string;
    onCompleted?: (result: { reportId: string; reportMarkdown?: string; reportData?: ExecutiveReportData }) => void;
    onError?: (error: string) => void;
}

export function useExecutiveReportJob(options: UseExecutiveReportJobOptions) {
    const { tenantId, organizationName = 'Tenant', onCompleted, onError } = options;
    const { instance, accounts } = useMsal();
    const addAction = useActionLogStore((s) => s.addAction);

    const isMock = isMockTenant(tenantId || '');

    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<ReportJobStep>('QUEUED');
    const [progressPercent, setProgressPercent] = useState<number>(0);
    const [currentStepLabel, setCurrentStepLabel] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [completedData, setCompletedData] = useState<{
        reportId: string;
        reportMarkdown?: string;
        reportData?: ExecutiveReportData;
    } | null>(null);

    const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
    const onCompletedRef = useRef(onCompleted);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onCompletedRef.current = onCompleted;
        onErrorRef.current = onError;
    }, [onCompleted, onError]);


    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || !accounts[0]) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return { Authorization: `Bearer ${token}` };
        } catch {
            return {};
        }
    }, [accounts, instance, isMock]);

    // Limpiar polling
    const stopPolling = useCallback(() => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    // Disparar notificaciones al completar
    const triggerCompletionNotifications = useCallback((repId: string) => {
        // 1. In-App Action Center
        addAction({
            message: `Reporte Ejecutivo FinOps Compilado (${organizationName})`,
            status: 'info',
            href: `/es/admin/reports?tab=executive&reportJob=${repId}`,
        });

        // 2. HTML5 Web Notification API
        if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    const notif = new Notification('Reporte Ejecutivo Listo', {
                        body: `El reporte FinOps de ${organizationName} ya está disponible para su descarga y análisis.`,
                        icon: '/favicon.ico',
                        tag: `finops-report-${repId}`,
                    });
                    notif.onclick = () => {
                        window.focus();
                        window.location.href = `/es/admin/reports?tab=executive&reportJob=${repId}`;
                    };
                } catch {
                    // ignore notification errors
                }
            }
        }
    }, [addAction, organizationName]);

    // Consultar estado de un jobId
    const pollStatus = useCallback(async (jobIdToPoll: string) => {
        if (!tenantId || !jobIdToPoll) return;
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/reports/executive/job-status?jobId=${encodeURIComponent(jobIdToPoll)}&tenantId=${encodeURIComponent(tenantId)}`, { headers });
            const json: JobStatusResponse = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || 'Error al consultar estado del reporte');
            }

            setStatus(json.status);
            setProgressPercent(json.progressPercent);
            setCurrentStepLabel(json.currentStepLabel);

            if (json.isCompleted) {
                stopPolling();
                setIsProcessing(false);
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${tenantId}`);
                }

                const result = {
                    reportId: json.reportId || jobIdToPoll,
                    reportMarkdown: json.reportMarkdown,
                    reportData: json.reportData,
                };
                setCompletedData(result);
                toast.success('Reporte ejecutivo generado con éxito.');
                triggerCompletionNotifications(json.reportId || jobIdToPoll);
                onCompletedRef.current?.(result);
            } else if (json.isFailed) {
                stopPolling();
                setIsProcessing(false);
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${tenantId}`);
                }
                const errMsg = json.error || 'Fallo durante la generación del reporte';
                setError(errMsg);
                toast.error(errMsg);
                onErrorRef.current?.(errMsg);
            }
        } catch (err: unknown) {
            console.warn('[useExecutiveReportJob] Poll error:', err);
        }
    }, [tenantId, authHeaders, stopPolling, triggerCompletionNotifications]);

    // Iniciar una nueva tarea asíncrona
    const startJob = useCallback(async (payload: Omit<StartReportJobPayload, 'tenantId'>) => {
        if (!tenantId) {
            toast.error('Selecciona un tenant para continuar');
            return;
        }

        // Solicitar permiso de notificaciones proactivamente al interactuar
        void requestNotificationPermission();

        setIsProcessing(true);
        setError(null);
        setStatus('QUEUED');
        setProgressPercent(5);
        setCurrentStepLabel('Iniciando tarea en segundo plano...');

        try {
            const headers = await authHeaders();
            const res = await fetch('/api/reports/executive/start-job', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({
                    tenantId,
                    ...payload,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || 'No se pudo iniciar el trabajo en segundo plano');
            }

            const jobId = String(json.jobId);
            setActiveJobId(jobId);
            if (typeof window !== 'undefined') {
                window.sessionStorage.setItem(`${STORAGE_PREFIX}${tenantId}`, jobId);
            }

            // Iniciar polling
            stopPolling();
            pollTimerRef.current = setInterval(() => {
                void pollStatus(jobId);
            }, POLL_INTERVAL_MS);

            // Primer poll inmediato
            void pollStatus(jobId);
        } catch (err: unknown) {
            setIsProcessing(false);
            const msg = err instanceof Error ? err.message : 'Error al iniciar la tarea';
            setError(msg);
            toast.error(msg);
            onErrorRef.current?.(msg);
        }
    }, [tenantId, authHeaders, stopPolling, pollStatus]);

    // Reanudar tracking si hay un job en sessionStorage o en backend al montar
    useEffect(() => {
        if (!tenantId || tenantId === 'default') return;

        const storedJobId = typeof window !== 'undefined'
            ? window.sessionStorage.getItem(`${STORAGE_PREFIX}${tenantId}`)
            : null;

        if (storedJobId) {
            setActiveJobId(storedJobId);
            setIsProcessing(true);
            stopPolling();
            pollTimerRef.current = setInterval(() => {
                void pollStatus(storedJobId);
            }, POLL_INTERVAL_MS);
            void pollStatus(storedJobId);
        }

        return () => {
            stopPolling();
        };
    }, [tenantId, stopPolling, pollStatus]);

    return {
        activeJobId,
        status,
        progressPercent,
        currentStepLabel,
        isProcessing,
        error,
        completedData,
        startJob,
        stopPolling,
    };
}
