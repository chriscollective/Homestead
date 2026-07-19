import { describe, expect, it } from 'vitest';
import { interpolateCurve, matureCanopyRadius } from './growth';

const curve = [
  { year: 0, value: 0.5 },
  { year: 5, value: 4 },
  { year: 10, value: 8 },
];

describe('interpolateCurve', () => {
  it('關鍵點上取原值', () => {
    expect(interpolateCurve(curve, 5)).toBe(4);
  });
  it('關鍵點之間線性插值', () => {
    expect(interpolateCurve(curve, 2.5)).toBeCloseTo(2.25);
    expect(interpolateCurve(curve, 7.5)).toBeCloseTo(6);
  });
  it('超出範圍時 clamp 至端點值', () => {
    expect(interpolateCurve(curve, -3)).toBe(0.5);
    expect(interpolateCurve(curve, 50)).toBe(8);
  });
  it('空曲線回傳 0', () => {
    expect(interpolateCurve([], 3)).toBe(0);
  });
});

describe('matureCanopyRadius', () => {
  it('取冠幅曲線末值的一半', () => {
    expect(matureCanopyRadius(curve)).toBe(4);
  });
});
