import { describe, it, expect } from 'vitest';

interface TrialState {
  daysLeft: number | null;
  severity: 'info' | 'warning' | 'critical' | null;
  expired: boolean;
}

/**
 * Helper to get trial state from subscription_status and trial_ends_at
 */
function getTrialState(status: string | null, trialEndsAt: string | null): TrialState {
  if (!status || !trialEndsAt) {
    return { daysLeft: null, severity: null, expired: false };
  }

  if (status === 'EXPIRED') {
    return { daysLeft: 0, severity: null, expired: true };
  }

  if (status !== 'TRIAL') {
    return { daysLeft: null, severity: null, expired: false };
  }

  const now = new Date();
  const endDate = new Date(trialEndsAt);
  const diffTime = endDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let severity: 'info' | 'warning' | 'critical' = 'info';
  if (daysLeft <= 2) {
    severity = 'critical';
  } else if (daysLeft <= 7) {
    severity = 'warning';
  }

  return { daysLeft: Math.max(0, daysLeft), severity, expired: false };
}

describe('trialStatus', () => {
  it('should return null values for non-trial status', () => {
    const state = getTrialState('ACTIVE', '2026-07-13T00:00:00');
    expect(state.daysLeft).toBeNull();
    expect(state.severity).toBeNull();
    expect(state.expired).toBe(false);
  });

  it('should return expired=true for EXPIRED status', () => {
    const state = getTrialState('EXPIRED', '2026-06-13T00:00:00');
    expect(state.expired).toBe(true);
    expect(state.daysLeft).toBe(0);
    expect(state.severity).toBeNull();
  });

  it('should return info severity for >7 days left', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const dateStr = futureDate.toISOString().slice(0, 19);
    
    const state = getTrialState('TRIAL', dateStr);
    expect(state.severity).toBe('info');
    expect(state.daysLeft).toBeGreaterThanOrEqual(9);
    expect(state.daysLeft).toBeLessThanOrEqual(11);
    expect(state.expired).toBe(false);
  });

  it('should return warning severity for 3-7 days left', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const dateStr = futureDate.toISOString().slice(0, 19);
    
    const state = getTrialState('TRIAL', dateStr);
    expect(state.severity).toBe('warning');
    expect(state.daysLeft).toBeGreaterThanOrEqual(4);
    expect(state.daysLeft).toBeLessThanOrEqual(6);
  });

  it('should return critical severity for <=2 days left', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const dateStr = futureDate.toISOString().slice(0, 19);
    
    const state = getTrialState('TRIAL', dateStr);
    expect(state.severity).toBe('critical');
    expect(state.daysLeft).toBeGreaterThanOrEqual(0);
    expect(state.daysLeft).toBeLessThanOrEqual(2);
  });

  it('should return null for missing status', () => {
    const state = getTrialState(null, '2026-07-13T00:00:00');
    expect(state.daysLeft).toBeNull();
    expect(state.severity).toBeNull();
  });

  it('should return null for missing trial_ends_at', () => {
    const state = getTrialState('TRIAL', null);
    expect(state.daysLeft).toBeNull();
    expect(state.severity).toBeNull();
  });

  it('should handle PAST_DUE status', () => {
    const state = getTrialState('PAST_DUE', '2026-07-13T00:00:00');
    expect(state.daysLeft).toBeNull();
    expect(state.severity).toBeNull();
    expect(state.expired).toBe(false);
  });
});
