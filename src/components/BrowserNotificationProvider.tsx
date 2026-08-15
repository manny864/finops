'use client';

import { useEffect, useRef, useState } from 'react';
import { usePendingDeletionsStore } from '@/store/pendingDeletionsStore';
import { useLocale } from 'next-intl';
import { Bell } from 'lucide-react';

const DISMISSED_KEY = 'finops_browser_notifications_dismissed';

export default function BrowserNotificationProvider() {
  const locale = useLocale();
  const pendingDeletions = usePendingDeletionsStore((state) => state.pending);
  const removePending = usePendingDeletionsStore((state) => state.removePending);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [mounted, setMounted] = useState<boolean>(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = Notification.permission;
      setPermissionState(perm);
      const isDismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
      // Si el permiso ya fue otorgado o denegado en el navegador, o el usuario ya lo descartó, no mostrar
      setDismissed(isDismissed || perm === 'granted' || perm === 'denied');
    } else {
      setDismissed(true);
    }
  }, []);

  const requestPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        setPermissionState(permission);
        setDismissed(true);
        localStorage.setItem(DISMISSED_KEY, 'true');
      }).catch(console.error);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
  };

  // Polling para chequear el estado de los recursos pendientes
  useEffect(() => {
    const pendingIds = Object.keys(pendingDeletions);
    
    if (pendingIds.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const checkStatus = async () => {
      const byTenant: Record<string, string[]> = {};
      pendingIds.forEach(id => {
        const item = pendingDeletions[id];
        if (!byTenant[item.tenantId]) byTenant[item.tenantId] = [];
        byTenant[item.tenantId].push(id);
      });

      for (const [tenantId, resourceIds] of Object.entries(byTenant)) {
        try {
          const res = await fetch('/api/resources/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, resourceIds })
          });

          if (res.ok) {
            const data = await res.json();
            const existingIds = new Set(data.existingResourceIds.map((id: string) => id.toLowerCase()));

            resourceIds.forEach(id => {
              if (!existingIds.has(id.toLowerCase())) {
                const item = pendingDeletions[id];
                
                if ('Notification' in window && Notification.permission === 'granted') {
                  new Notification('FinOps: Recurso Eliminado', {
                    body: `El recurso "${item.name}" ha sido eliminado exitosamente.`,
                    icon: '/icon.png' 
                  });
                }
                
                removePending(id);
              }
            });
          }
        } catch (error) {
          console.error("Error checking pending deletions status", error);
        }
      }
    };

    checkStatus();
    intervalRef.current = setInterval(checkStatus, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [pendingDeletions, removePending]);

  // Si no está montado en cliente, o ya fue descartado, o ya tiene permiso otorgado/denegado, no renderizar nada
  if (!mounted || dismissed || permissionState !== 'default') {
    return null;
  }

  const isEn = locale.startsWith('en');
  const isPt = locale.startsWith('pt');

  const title = isEn ? 'Enable Notifications' : isPt ? 'Ativar Notificações' : 'Habilitar notificaciones';
  const desc = isEn
    ? 'Receive alerts when background cloud tasks complete.'
    : isPt
    ? 'Receba alertas quando as tarefas em segundo plano forem concluídas.'
    : 'Recibe alertas cuando finalicen las tareas de fondo.';
  const dismissBtn = isEn ? 'Not now' : isPt ? 'Agora não' : 'Ahora no';
  const enableBtn = isEn ? 'Enable' : isPt ? 'Ativar' : 'Activar';

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-white dark:bg-slate-900 border border-brand-bright/30 dark:border-slate-800 text-ink dark:text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
      <div className="p-2 rounded-lg bg-brand-soft text-brand-deep dark:bg-brand-deep/20 dark:text-brand-bright">
        <Bell className="w-4 h-4" />
      </div>
      <div>
        <p className="font-bold text-xs">{title}</p>
        <p className="text-[11px] text-ink-soft dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-2 ml-auto pl-3 border-l border-line dark:border-slate-800">
        <button 
          onClick={handleDismiss}
          className="text-xs font-medium text-grey hover:text-ink dark:hover:text-white transition-colors px-2 py-1"
        >
          {dismissBtn}
        </button>
        <button 
          onClick={requestPermission}
          className="text-xs font-bold bg-brand-deep text-white px-3 py-1.5 rounded-lg hover:bg-brand-bright transition-colors shadow-sm"
        >
          {enableBtn}
        </button>
      </div>
    </div>
  );
}
