import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { METRIC_GLOSSARY, type MetricKey } from './glossary'

// An accessible "what is this metric" explainer. Renders the popover in a portal so it
// is never clipped by overflow:hidden on metric cards / table panels, flips above the
// trigger near the bottom edge, and opens on hover, keyboard focus, and tap.
export function MetricInfo({ metric, size = 13 }: { metric: MetricKey; size?: number }) {
  const entry = METRIC_GLOSSARY[metric]
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean }>({
    top: 0,
    left: 0,
    flip: false,
  })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const W = 260
    const M = 8
    const below = window.innerHeight - b.bottom > 170
    let left = b.left + b.width / 2 - W / 2
    left = Math.max(M, Math.min(left, window.innerWidth - W - M))
    setPos({ top: below ? b.bottom + 8 : b.top - 8, left, flip: !below })
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (
        event.type === 'pointerdown' &&
        (btnRef.current?.contains(event.target as Node) ||
          popRef.current?.contains(event.target as Node))
      )
        return
      setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  if (!entry) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="metric-info-btn"
        aria-label={`Что такое «${entry.label}»`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <Info size={size} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            className={`metric-info-pop${pos.flip ? ' flip' : ''}`}
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <strong className="mi-label">{entry.label}</strong>
            <p className="mi-what">{entry.what}</p>
            <div className="mi-formula">
              <span className="eyebrow">КАК СЧИТАЕМ</span>
              <code>{entry.formula}</code>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
