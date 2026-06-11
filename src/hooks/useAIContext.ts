import { create } from 'zustand';

interface AIContextState {
    currentPage: string;
    currentDataPayload: any;
    setPageContext: (page: string, data: any) => void;
}

export const useAIContext = create<AIContextState>((set) => ({
    currentPage: 'Dashboard',
    currentDataPayload: null,
    setPageContext: (page, data) => set({ currentPage: page, currentDataPayload: data })
}));
