import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_SCOPES, planScopes } from './scope-planner';

describe('planScopes', () => {
  it('returns no scopes for no bounding boxes', () => {
    expect(planScopes([])).toEqual([]);
  });

  it('maps a narrow bounding box onto the canonical global grid', () => {
    expect(planScopes([[116, 39, 117, 40]])).toEqual([
      expect.objectContaining({
        bbox: [115, 35, 120, 40],
        latitude: 37.5,
        longitude: 117.5,
        cacheKey: expect.stringMatching(/^cell:/),
      }),
    ]);
  });

  it('maps tiny scopes to a supported canonical query circle', () => {
    const scope = planScopes([[116, 39, 116.000001, 39.000001]])[0];
    expect(scope?.bbox).toEqual([115, 35, 120, 40]);
    expect(scope?.radiusNm).toBeGreaterThanOrEqual(1);
    expect(scope?.radiusNm).toBeLessThanOrEqual(250);
  });

  it('reuses canonical cells so duplicate and nested inputs add no redundant coverage', () => {
    const once = planScopes([[100, 20, 130, 50]]);
    const repeated = planScopes([
      [100, 20, 130, 50],
      [100, 20, 130, 50],
      [101, 21, 129, 49],
    ]);

    expect(repeated).toEqual(once);
  });

  it('splits antimeridian scopes into legal cells on both sides', () => {
    const scopes = planScopes([[170, 20, -170, 40]]);

    expect(scopes.every((scope) => scope.bbox[0] <= scope.bbox[2])).toBe(true);
    expect(scopes.some((scope) => scope.bbox[0] >= 170)).toBe(true);
    expect(scopes.some((scope) => scope.bbox[2] <= -170)).toBe(true);
  });

  it('prioritizes both sides nearest the circular center before truncating an antimeridian view', () => {
    const scopes = planScopes([[170, 20, -170, 40]], { maxScopes: 2 });

    expect(scopes).toHaveLength(2);
    expect(scopes.some((scope) => scope.bbox[0] >= 175)).toBe(true);
    expect(scopes.some((scope) => scope.bbox[2] <= -175)).toBe(true);
  });

  it('tiles large scopes with finite query points and supported radii', () => {
    const scopes = planScopes([[-180, -90, 180, 90]]);

    expect(scopes).toHaveLength(DEFAULT_MAX_SCOPES);
    expect(scopes.every((scope) => Number.isFinite(scope.latitude))).toBe(true);
    expect(scopes.every((scope) => Number.isFinite(scope.longitude))).toBe(true);
    expect(scopes.every((scope) => Number.isInteger(scope.radiusNm))).toBe(true);
    expect(scopes.every((scope) => scope.radiusNm >= 1 && scope.radiusNm <= 250)).toBe(true);
  });

  it('covers a high-latitude antimeridian view with finite supported query circles', () => {
    const input = [170, 85, -170, 90] as const;
    const scopes = planScopes([input]);

    expect(scopes).toHaveLength(4);
    expect(scopes.every((scope) => Number.isFinite(scope.latitude))).toBe(true);
    expect(scopes.every((scope) => Number.isFinite(scope.longitude))).toBe(true);
    expect(scopes.every((scope) => scope.radiusNm >= 1 && scope.radiusNm <= 250)).toBe(true);
    expect(Math.min(...scopes.map((scope) => scope.bbox[0]))).toBe(-180);
    expect(Math.max(...scopes.map((scope) => scope.bbox[2]))).toBe(180);
    expect(Math.min(...scopes.map((scope) => scope.bbox[1]))).toBe(85);
    expect(Math.max(...scopes.map((scope) => scope.bbox[3]))).toBe(90);
  });

  it('rejects invalid runtime bounding boxes', () => {
    expect(() => planScopes([[0, 20, 10, 20]])).toThrow();
    expect(() => planScopes([[0, -91, 10, 20]])).toThrow();
  });

  it('truncates deterministically and prioritizes cells near the input center', () => {
    const bbox = [0, -30, 60, 30] as const;
    const first = planScopes([bbox], { maxScopes: 3 });
    const second = planScopes([bbox], { maxScopes: 3 });

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
    const distances = first.map(
      (scope) => Math.abs(scope.latitude) + Math.abs(scope.longitude - 30),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('keeps earlier active views ahead of later input views when truncating', () => {
    const first = planScopes([[100, 20, 101, 21]], { maxScopes: 1 });
    const combined = planScopes(
      [
        [100, 20, 101, 21],
        [-80, 30, -79, 31],
      ],
      { maxScopes: 1 },
    );

    expect(combined).toEqual(first);
  });

  it('does not inspect lower-priority inputs after the scope limit is filled', () => {
    const inputs = [[-180, -90, 180, 90]] as unknown as Array<
      readonly [number, number, number, number]
    >;
    Object.defineProperty(inputs, 1, {
      get() {
        throw new Error('lower-priority bbox was inspected');
      },
    });
    inputs.length = 2;

    expect(() => planScopes(inputs, { maxScopes: 1 })).not.toThrow();
  });
});
