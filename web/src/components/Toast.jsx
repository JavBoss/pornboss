import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const getContainer = () =>
  typeof document === 'undefined' ? null : document.fullscreenElement || document.body

export default function Toast({ open, message, onClose, duration = 1800, centered = false }) {
  const [container, setContainer] = useState(getContainer)

  useEffect(() => {
    // A fullscreen element sits above the document, including body portals.
    const updateContainer = () => setContainer(getContainer())
    updateContainer()
    document.addEventListener('fullscreenchange', updateContainer)
    return () => document.removeEventListener('fullscreenchange', updateContainer)
  }, [])

  useEffect(() => {
    if (!open || !message) return undefined
    const timer = window.setTimeout(() => onClose?.(), duration)
    return () => window.clearTimeout(timer)
  }, [duration, message, onClose, open])

  if (!open || !message || !container) return null

  return createPortal(
    <div
      className={`app-toast-overlay pointer-events-none fixed ${
        centered
          ? 'inset-0 flex items-center justify-center px-4'
          : 'bottom-4 right-4 max-w-[calc(100vw-2rem)]'
      }`}
    >
      <div
        role={centered ? 'alert' : 'status'}
        aria-live={centered ? 'assertive' : 'polite'}
        className="max-w-md rounded-lg bg-zinc-800/95 px-5 py-3 text-center text-sm leading-6 text-white shadow-xl backdrop-blur"
      >
        {message}
      </div>
    </div>,
    container
  )
}
