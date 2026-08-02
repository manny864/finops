import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PendingDeletion {
  id: string; // The resourceId (usually full ARM ID)
  name: string; // The resource name for display
  type: string; // The resource type
  addedAt: number; // Timestamp when it was added
  tenantId: string; // the tenant it belongs to
}

interface PendingDeletionsState {
  pending: Record<string, PendingDeletion>;
  addPending: (item: Omit<PendingDeletion, 'addedAt'>) => void;
  removePending: (id: string) => void;
  isPending: (id: string) => boolean;
}

export const usePendingDeletionsStore = create<PendingDeletionsState>()(
  persist(
    (set, get) => ({
      pending: {},
      addPending: (item) => set((state) => ({
        pending: {
          ...state.pending,
          [item.id]: { ...item, addedAt: Date.now() }
        }
      })),
      removePending: (id) => set((state) => {
        const newPending = { ...state.pending };
        delete newPending[id];
        return { pending: newPending };
      }),
      isPending: (id) => !!get().pending[id],
    }),
    {
      name: 'finops-pending-deletions',
    }
  )
);
