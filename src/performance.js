export const MOBILE_LIMITS = Object.freeze({ cars: 13, pedestrians: 24, vehicleRadius: 65, pedestrianRadius: 45, fps: 60, dpr: 0.8 });

export function sampleEvenly(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * items.length / limit)]);
}

export function frameDue(time, last, fps = 60) {
  return last == null || time - last >= 1000 / fps - 0.25;
}
