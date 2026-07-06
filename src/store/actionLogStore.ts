import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ActionLog {
    id: string;
    message: string;
    // Serializado a ISO string por el middleware persist; usar new Date(timestamp) al mostrar.
    timestamp: Date | string;
    status: 'success' | 'error' | 'info';
    // Destino opcional: si está presente, el item de la campanita navega ahí al clicarlo.
    href?: string;
}

interface ActionLogState {
    actions: ActionLog[];
    addAction: (action: Omit<ActionLog, 'id' | 'timestamp'>) => void;
    clearActions: () => void;
}

const MAX_HISTORY = 50;

export const useActionLogStore = create<ActionLogState>()(
    persist(
        (set) => ({
            actions: [],
            addAction: (action) => set((state) => ({
                actions: [{ ...action, id: crypto.randomUUID(), timestamp: new Date() }, ...state.actions].slice(0, MAX_HISTORY)
            })),
            clearActions: () => set({ actions: [] })
        }),
        { name: 'finops-action-log' }
    )
);
