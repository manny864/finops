"use client";
import React, { createContext, useContext, useState } from 'react';

type ViewMode = 'executive' | 'engineer';

interface ViewModeContextType {
    viewMode: ViewMode;
    toggleViewMode: () => void;
}

const ViewModeContext = createContext<ViewModeContextType>({
    viewMode: 'executive',
    toggleViewMode: () => {},
});

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
    const [viewMode, setViewMode] = useState<ViewMode>('executive');

    const toggleViewMode = () => {
        setViewMode(prev => prev === 'executive' ? 'engineer' : 'executive');
    };

    return (
        <ViewModeContext.Provider value={{ viewMode, toggleViewMode }}>
            {children}
        </ViewModeContext.Provider>
    );
}

export function useViewMode() {
    return useContext(ViewModeContext);
}
