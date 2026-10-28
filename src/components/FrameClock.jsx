import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { frameDue } from '../performance.js'
import { useGameStore } from '../store/gameStore.js'

// Own the render clock so 120 Hz phones do not perform 120 scene updates.
// Bound catch-up to three fixed physics steps after an expensive frame.
export default function FrameClock() {
  const advance = useThree((state) => state.advance)
  const elapsed = useRef(0)
  useEffect(() => {
    let request, last = null, lastRender = null, lastRate = null
    const tick = (time) => {
      request = requestAnimationFrame(tick)
      const paused = useGameStore.getState().paused
      const rate = paused ? 10 : 60
      if (rate !== lastRate) { last = null; lastRender = null; lastRate = rate }
      if (!frameDue(time, last, rate)) return
      const delta = lastRender == null ? 1 / 60 : Math.min((time - lastRender) / 1000, 0.05)
      const interval = 1000 / rate
      last = last == null || time - last > 250 ? time : last + Math.max(1, Math.floor((time - last + 0.25) / interval)) * interval
      lastRender = time
      if (!paused) elapsed.current += delta
      advance(elapsed.current, false)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [advance])
  return null
}
