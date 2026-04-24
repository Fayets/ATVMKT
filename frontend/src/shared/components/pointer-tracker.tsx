'use client'

import { useEffect } from 'react'

export function PointerTracker() {
  useEffect(() => {
    let currentCard: HTMLElement | null = null

    const sync = (e: PointerEvent) => {
      // Find the closest glass-card under the cursor
      const target = e.target as HTMLElement
      const card = target.closest('.glass-card') as HTMLElement | null

      // Clear previous card if cursor left it
      if (currentCard && currentCard !== card) {
        currentCard.style.removeProperty('--mx')
        currentCard.style.removeProperty('--my')
        currentCard.classList.remove('glass-card--hover')
        currentCard = null
      }

      // Set local coordinates on the hovered card
      if (card) {
        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        card.style.setProperty('--mx', `${x}px`)
        card.style.setProperty('--my', `${y}px`)
        card.classList.add('glass-card--hover')
        currentCard = card
      }
    }

    const leave = () => {
      if (currentCard) {
        currentCard.style.removeProperty('--mx')
        currentCard.style.removeProperty('--my')
        currentCard.classList.remove('glass-card--hover')
        currentCard = null
      }
    }

    document.addEventListener('pointermove', sync)
    document.addEventListener('pointerleave', leave)
    return () => {
      document.removeEventListener('pointermove', sync)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return null
}
