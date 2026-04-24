'use client'

import { useEffect, useRef } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
}

export function Modal({ open, onClose, title, children, maxWidth = '620px' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="glass-card relative w-[90%] max-h-[90vh] overflow-y-auto p-8 accent-top"
        style={{ maxWidth }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-[11px] font-medium uppercase tracking-widest text-[var(--accent)] opacity-85">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(255,255,255,0.06)] text-[var(--text3)] transition-all hover:bg-[rgba(230,57,70,0.2)] hover:text-[var(--accent)]"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
