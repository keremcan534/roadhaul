import { describe, expect, it } from 'vitest';
import { Buckets } from '../../../../src/domain/world/buckets';

describe('Buckets', () => {
  it('finds a thing from any point in the cells its bounds cover, and from nowhere else', () => {
    const buckets = new Buckets(100);
    // x 20..180 and z -50..30: columns 0 and 1, rows -1 and 0, so x 0..200 and z -100..100.
    buckets.add(7, 20, 180, -50, 30);

    for (const [x, z] of [
      [20, -50],
      [0, -100],
      [99.9, 0],
      [100, 0],
      [199.9, 99.9],
      [150, -60],
    ] as const) {
      expect(buckets.at(x, z), `${x}, ${z}`).toEqual([7]);
    }
    for (const [x, z] of [
      [-0.1, 0],
      [200, 0],
      [50, 100],
      [50, -100.1],
      [-500, 700],
    ] as const) {
      expect(buckets.at(x, z), `${x}, ${z}`).toEqual([]);
    }
  });

  it('keeps everything filed in a cell, in the order it was filed', () => {
    const buckets = new Buckets(50);
    buckets.add(3, 10, 20, 10, 20);
    buckets.add(1, 0, 120, 0, 40);
    buckets.add(2, 60, 70, 60, 70);

    expect(buckets.at(15, 15)).toEqual([3, 1]);
    expect(buckets.at(110, 10)).toEqual([1]);
    expect(buckets.at(65, 65)).toEqual([2]);
    expect(buckets.at(65, 45)).toEqual([1]);
  });

  it('files a point in the one cell holding it', () => {
    const buckets = new Buckets(20);
    buckets.add(0, -30, -30, 45, 45);

    expect(buckets.at(-39.9, 40.1)).toEqual([0]);
    expect(buckets.at(-20, 45)).toEqual([]);
    expect(buckets.at(-30, 39.9)).toEqual([]);
  });

  it('tells the cells of a column and a row apart, on either side of the axes', () => {
    const buckets = new Buckets(10);
    buckets.add(1, 15, 15, 5, 5);
    buckets.add(2, 5, 5, 15, 15);
    buckets.add(3, -15, -15, -5, -5);
    buckets.add(4, -5, -5, -15, -15);

    expect(buckets.at(12, 8)).toEqual([1]);
    expect(buckets.at(8, 12)).toEqual([2]);
    expect(buckets.at(-12, -8)).toEqual([3]);
    expect(buckets.at(-8, -12)).toEqual([4]);
    expect(buckets.at(5, 5)).toEqual([]);
  });

  it('sizes its cells as asked', () => {
    const coarse = new Buckets(1000);
    const fine = new Buckets(10);
    coarse.add(9, 0, 5, 0, 5);
    fine.add(9, 0, 5, 0, 5);

    expect(coarse.at(900, 900)).toEqual([9]);
    expect(fine.at(900, 900)).toEqual([]);
    expect(fine.at(9, 9)).toEqual([9]);
    expect(fine.at(10, 0)).toEqual([]);
  });
});
