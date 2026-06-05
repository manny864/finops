import { create } from 'zustand';

export interface ActionLog {
    id: string;
    message: string;
    timestamp: Date;
    status: 'success' | 'error' | 'info';
}

interface ActionLogState {
    actions: ActionLog[];
    addAction: (action: Omit<ActionLog, 'id' | 'timestamp'>) => void;
    clearActions: () => void;
}

export const useActionLogStore = create<ActionLogState>((set) => ({
    actions: [],
    addAction: (action) => set((state) => ({
        actions: [{ ...action, id: crypto.randomUUID(), timestamp: new Date() }, ...state.actions]
    })),
    clearActions: () => set({ actions: [] })
}));
