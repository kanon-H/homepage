import { describe, expect, it } from "vitest";

import { getServiceMenuPosition } from "./menu-position";

// These prove coordinate math, not CSS layout, touch positioning or browser clipping.
describe("service menu viewport positioning", () => {
  it.each([
    [
      { x: 100, y: 80 },
      { width: 256, height: 200 },
      { width: 1024, height: 768 },
      { left: 100, top: 80 },
    ],
    [
      { x: 1000, y: 750 },
      { width: 256, height: 200 },
      { width: 1024, height: 768 },
      { left: 760, top: 560 },
    ],
    [
      { x: -30, y: -20 },
      { width: 256, height: 200 },
      { width: 1024, height: 768 },
      { left: 8, top: 8 },
    ],
    [
      { x: 315, y: 400 },
      { width: 256, height: 200 },
      { width: 320, height: 480 },
      { left: 56, top: 272 },
    ],
    [
      { x: 0, y: 0 },
      { width: 0, height: 0 },
      { width: 320, height: 480 },
      { left: 8, top: 8 },
    ],
  ])("clamps %j using measured %j and viewport %j", (point, size, viewport, expected) => {
    expect(getServiceMenuPosition(point, size, viewport)).toEqual(expected);
  });
});
