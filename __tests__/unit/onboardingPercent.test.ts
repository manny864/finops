import { describe, it, expect } from 'vitest';

function computePercent(progress: any): number {
    const steps = [
        progress.step_welcome,
        progress.step_azure_sp,
        progress.step_first_sync,
        progress.step_first_budget,
        progress.step_notifications,
    ];

    const completedOrSkipped = steps.filter(
        (s) => s === 'completed' || s === 'skipped'
    ).length;

    return Math.round((completedOrSkipped / steps.length) * 100);
}

describe('Onboarding Percent Calculation', () => {
    it('should return 0 when all steps are pending', () => {
        const progress = {
            step_welcome: 'pending',
            step_azure_sp: 'pending',
            step_first_sync: 'pending',
            step_first_budget: 'pending',
            step_notifications: 'pending',
        };
        expect(computePercent(progress)).toBe(0);
    });

    it('should return 20 when 1 step is completed', () => {
        const progress = {
            step_welcome: 'completed',
            step_azure_sp: 'pending',
            step_first_sync: 'pending',
            step_first_budget: 'pending',
            step_notifications: 'pending',
        };
        expect(computePercent(progress)).toBe(20);
    });

    it('should return 40 when 2 steps are completed', () => {
        const progress = {
            step_welcome: 'completed',
            step_azure_sp: 'completed',
            step_first_sync: 'pending',
            step_first_budget: 'pending',
            step_notifications: 'pending',
        };
        expect(computePercent(progress)).toBe(40);
    });

    it('should return 100 when all steps are completed', () => {
        const progress = {
            step_welcome: 'completed',
            step_azure_sp: 'completed',
            step_first_sync: 'completed',
            step_first_budget: 'completed',
            step_notifications: 'completed',
        };
        expect(computePercent(progress)).toBe(100);
    });

    it('should count skipped steps as completed', () => {
        const progress = {
            step_welcome: 'completed',
            step_azure_sp: 'skipped',
            step_first_sync: 'pending',
            step_first_budget: 'pending',
            step_notifications: 'pending',
        };
        expect(computePercent(progress)).toBe(40);
    });

    it('should return 100 when all steps are skipped', () => {
        const progress = {
            step_welcome: 'skipped',
            step_azure_sp: 'skipped',
            step_first_sync: 'skipped',
            step_first_budget: 'skipped',
            step_notifications: 'skipped',
        };
        expect(computePercent(progress)).toBe(100);
    });

    it('should return 60 when 3 steps are completed/skipped', () => {
        const progress = {
            step_welcome: 'completed',
            step_azure_sp: 'completed',
            step_first_sync: 'skipped',
            step_first_budget: 'pending',
            step_notifications: 'pending',
        };
        expect(computePercent(progress)).toBe(60);
    });
});
