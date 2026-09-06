import { useEffect } from 'react'

export default function Toast({ open, message, onClose, duration = 1800 }) {
  useEffect(() => {
    if (!open || !message) return
    const timer = window.setTimeout(() => {
      onClose?.()
    }, duration)
    return () => window.clearTimeout(timer)
  }, [duration, message, onClose, open])

  if (!open || !message) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] max-w-[calc(100vw-2rem)]">
      <div
        role="status"
        aria-live="polite"
        className="max-w-md rounded-lg bg-zinc-800/95 px-5 py-3 text-center text-sm leading-6 text-white shadow-xl backdrop-blur"
      >
        {message}
      </div>
    </div>
  )
}
