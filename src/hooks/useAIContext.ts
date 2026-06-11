import { create } from 'zustand';

interface AIContextState {
    currentPage: string;
    currentDataPayload: any;
    isOpen: boolean;
    injectedPrompt: string | null;
    setPageContext: (page: string, data: any) => void;
    setIsOpen: (isOpen: boolean) => void;
    triggerCopilotWithPrompt: (prompt: string | null) => void;
}

export const useAIContext = create<AIContextState>((set) => ({
    currentPage: 'Dashboard',
    currentDataPayload: null,
    isOpen: false,
    injectedPrompt: null,
    setPageContext: (page, data) => set({ currentPage: page, currentDataPayload: data }),
    setIsOpen: (isOpen) => set({ isOpen }),
    triggerCopilotWithPrompt: (prompt) => set({ isOpen: true, injectedPrompt: prompt })
}));
