// Fixed-position menu coordinates, clamped inside the viewport with an 8px gap.
// Measuring the DOM/viewport is the component's lifecycle responsibility.
export function getServiceMenuPosition(point, size, viewport) {
  const gap = 8;
  return {
    left: Math.max(gap, Math.min(point.x, viewport.width - size.width - gap)),
    top: Math.max(gap, Math.min(point.y, viewport.height - size.height - gap)),
  };
}
