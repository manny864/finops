import { create } from 'zustand';

interface DashboardState {
    dashboardData: any[];
    complianceScore: number | null;
    lastFetchedTenantId: string | null;
    anomaliesChecked: boolean;
    setDashboardState: (tenantId: string, dashboardData: any[], complianceScore: number | null) => void;
    setAnomaliesChecked: (checked: boolean) => void;
    clearDashboardState: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
    dashboardData: [],
    complianceScore: null,
    lastFetchedTenantId: null,
    anomaliesChecked: false,
    setDashboardState: (tenantId, dashboardData, complianceScore) => set({ lastFetchedTenantId: tenantId, dashboardData, complianceScore }),
    setAnomaliesChecked: (checked) => set({ anomaliesChecked: checked }),
    clearDashboardState: () => set({ lastFetchedTenantId: null, dashboardData: [], complianceScore: null, anomaliesChecked: false }),
}));
