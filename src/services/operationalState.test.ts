import { describe, expect, it } from 'vitest';
import { mergePercentComplete, shouldApplyTaskState, telemetryLabel } from './operationalState';

describe('operational state', () => {
  it('does not regress a terminal task to active', () => {
    expect(shouldApplyTaskState('COMPLETED', 'ACTIVE')).toBe(false);
    expect(shouldApplyTaskState('FAILED', 'PENDING')).toBe(false);
  });

  it('allows forward and terminal transitions', () => {
    expect(shouldApplyTaskState('PENDING', 'ACTIVE')).toBe(true);
    expect(shouldApplyTaskState('ACTIVE', 'COMPLETED')).toBe(true);
    expect(shouldApplyTaskState('ACTIVE', 'PREEMPTING')).toBe(true);
  });

  it('keeps progress monotonic', () => {
    expect(mergePercentComplete(60, 20)).toBe(60);
    expect(mergePercentComplete(60, 90)).toBe(90);
  });

  it('reports stale positioned vehicles separately from known vehicles', () => {
    expect(telemetryLabel({ position: { latitude: 1, longitude: 2 }, lastSeen: 1_000 }, 12_000, 10_000)).toBe('STALE');
    expect(telemetryLabel({ position: undefined, lastSeen: 1_000 }, 12_000, 10_000)).toBe('KNOWN');
  });
});
