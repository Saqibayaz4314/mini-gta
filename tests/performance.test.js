import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MOBILE_LIMITS, sampleEvenly, frameDue } from '../src/performance.js'
import { BLOCKS, TRAFFIC } from '../src/world.js'

test('mobile reduces the number of physical pedestrians and traffic bodies', () => {
  const cars = [TRAFFIC[0], ...sampleEvenly(TRAFFIC.slice(1), MOBILE_LIMITS.cars - 1)]
  const people = sampleEvenly(BLOCKS, MOBILE_LIMITS.pedestrians / 2).length * 2
  assert.equal(cars.length, 13)
  assert.equal(people, 24)
  assert.equal(cars[0].id, 'parked-coupe')
  assert.ok(new Set(cars.map((car) => car.id)).size === cars.length)
  assert.ok(cars.some((car) => car.axis === 'x') && cars.some((car) => car.axis === 'z'))
})

test('the mobile rendering budget avoids retina-sized buffers and retains 60 Hz physics', () => {
  assert.ok(MOBILE_LIMITS.dpr < 1)
  assert.equal(MOBILE_LIMITS.fps, 60)
  assert.ok(MOBILE_LIMITS.vehicleRadius > 3)
})

test('60 fps render scheduling does not double work on a 120 Hz display', () => {
  for (const hz of [60, 80, 90, 120]) {
    let last = null, frames = 0
    for (let index = 0; index < hz; index++) {
      const time = index * 1000 / hz
      if (!frameDue(time, last, 60)) continue
      frames++
      const interval = 1000 / 60
      last = last == null ? time : last + Math.max(1, Math.floor((time - last + 0.25) / interval)) * interval
    }
    assert.ok(frames >= 59 && frames <= 61, `${hz} Hz display rendered ${frames} frames`)
  }
})
