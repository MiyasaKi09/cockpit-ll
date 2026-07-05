// Kit UI partagé — composants sobres, cohérents sur tous les modules.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { copier } from './prompts'
import { fmtDate, fmtMoney, parseNum, todayISO } from './util'

// ---------- routage hash minimal ----------

export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const clean = hash.replace(/^#\/?/, '')
  return clean === '' ? [''] : clean.split('/').map(decodeURIComponent)
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`
}

/** date du jour, rafraîchie si l'onglet reste ouvert au changement de jour */
export function useToday(): string {
  const [t, setT] = useState(todayISO)
  useEffect(() => {
    const iv = setInterval(() => setT(todayISO()), 60_000)
    return () => clearInterval(iv)
  }, [])
  return t
}

// ---------- structure de page ----------

export function Page({
  titre,
  sousTitre,
  actions,
  children,
}: {
  titre: string
  sousTitre?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="page">
      <header className="page-h">
        <div>
          <h1>{titre}</h1>
          {sousTitre && <p className="page-sub">{sousTitre}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function Card({
  titre,
  actions,
  children,
  className,
}: {
  titre?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className || ''}`}>
      {(titre || actions) && (
        <div className="card-h">
          {titre && <h2>{titre}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Stat({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  /** liseré supérieur bauhaus (repère catégoriel) */
  accent?: 'blue' | 'yellow' | 'red'
}) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''} ${accent ? `stat-acc-${accent}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/** jauge de progression réutilisable (objectif CA, budget d'heures…) */
export function Progress({
  value,
  max,
  header,
  couleur,
}: {
  value: number
  max: number
  /** ligne d'en-tête optionnelle (label à gauche, valeur à droite) */
  header?: ReactNode
  /** couleur imposée ; sinon dérivée du taux (rouge < 60 % < jaune < 100 % ≤ vert) */
  couleur?: string
}) {
  const pct = max > 0 ? value / max : 0
  const c = couleur || (pct >= 1 ? 'var(--ok)' : pct >= 0.6 ? 'var(--warn)' : 'var(--danger)')
  return (
    <div>
      {header && <div className="progress-head small">{header}</div>}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%`, background: c }} />
      </div>
    </div>
  )
}

export function Money({ v, cents }: { v: number | null | undefined; cents?: boolean }) {
  return <span className="num">{fmtMoney(v, cents)}</span>
}

export function DateF({ d }: { d: string | null | undefined }) {
  return <span>{fmtDate(d)}</span>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

// ---------- icônes (jeu de traits, style Lucide, currentColor) ----------

export type IconName =
  | 'bolt' | 'activity' | 'mail' | 'hardhat' | 'scale' | 'rocket' | 'flag'
  | 'user' | 'shield' | 'printer' | 'file' | 'trophy' | 'sun' | 'moon'
  | 'mic' | 'camera' | 'phone' | 'calendar' | 'car' | 'users' | 'arrowDown'
  | 'alert' | 'star' | 'search' | 'check' | 'party'

const ICON_PATHS: Record<IconName, ReactNode> = {
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </>
  ),
  hardhat: (
    <>
      <path d="M2 18h20 M4 18v-2a8 8 0 0 1 16 0v2" />
      <path d="M10 9V6a2 2 0 0 1 4 0v3" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18 M7 21h10 M4 7h4c2 0 4-1 4-1s2 1 4 1h4" />
      <path d="M6 7l-3 7a3 3 0 0 0 6 0z M18 7l-3 7a3 3 0 0 0 6 0z" />
    </>
  ),
  rocket: (
    <>
      <path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2a2 2 0 1 0-3-3z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  printer: (
    <>
      <path d="M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" />
      <path d="M9 13h6 M9 17h6" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16 M10 15v3c0 1-1 2-3 4 M14 15v3c0 1 1 2 3 4 M18 2H6v7a6 6 0 0 0 12 0z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />,
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3" />
    </>
  ),
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4 M16 2v4 M3 10h18" />
    </>
  ),
  car: (
    <>
      <path d="M19 17h2v-5.5a2 2 0 0 0-.4-1.2l-2.1-2.8a2 2 0 0 0-1.6-.8H7.2a2 2 0 0 0-1.8 1.1L3.5 11.4a2 2 0 0 0-.5 1.1V17h2 M7 17h10" />
      <circle cx="6.5" cy="18.5" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  arrowDown: <path d="M12 5v14 M19 12l-7 7-7-7" />,
  alert: <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01" />,
  star: <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  party: <path d="M5.8 11.3 2 22l10.7-3.8 M4 3h.01 M22 8h.01 M15 2h.01 M22 20h.01 M22 2l-2.2.6a2 2 0 0 0-1.3 2.9l.3.6a2 2 0 0 1-1.3 2.9L15 9 M2 8a2 2 0 0 1 1.6 4l-1 1.3M11 13a2 2 0 0 0 4 0 2 2 0 0 0-2-2" />,
}

export function Icon({
  name,
  size = 16,
  className,
  title,
  style,
}: {
  name: IconName
  size?: number
  className?: string
  title?: string
  style?: CSSProperties
}) {
  return (
    <svg
      className={`icon ${className || ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// ---------- menu d'actions de ligne (« ··· ») ----------

export interface MenuAction {
  label: string
  onClick: () => void
  danger?: boolean
  title?: string
}

/** bouton « ··· » ouvrant un menu déroulant — pour désencombrer les tableaux */
export function RowMenu({ items }: { items: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="rowmenu" ref={ref}>
      <button
        className="btn btn-small btn-ghost rowmenu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Plus d'actions"
      >
        ⋯
      </button>
      {open && (
        <div className="rowmenu-pop" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              className={`rowmenu-item ${it.danger ? 'rowmenu-danger' : ''}`}
              title={it.title}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- toasts + undo (feedback global, sans provider) ----------

interface ToastItem {
  id: number
  message: string
  tone?: Tone
  undo?: () => void
}

let toastsCourants: ToastItem[] = []
let toastSeq = 1
const toastListeners = new Set<() => void>()
const emettreToasts = () => toastListeners.forEach((l) => l())

function retirerToast(id: number) {
  toastsCourants = toastsCourants.filter((t) => t.id !== id)
  emettreToasts()
}

/** affiche un message éphémère ; `undo` ajoute un bouton « Annuler ». */
export function toast(message: string, opts?: { tone?: Tone; undo?: () => void }) {
  const id = toastSeq++
  toastsCourants = [...toastsCourants, { id, message, tone: opts?.tone, undo: opts?.undo }]
  emettreToasts()
  setTimeout(() => retirerToast(id), opts?.undo ? 8000 : 4500)
  return id
}

/** conteneur des toasts — à monter une fois à la racine de l'app. */
export function ToastHost() {
  const [, forcer] = useState(0)
  useEffect(() => {
    const l = () => forcer((x) => x + 1)
    toastListeners.add(l)
    return () => {
      toastListeners.delete(l)
    }
  }, [])
  if (toastsCourants.length === 0) return null
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toastsCourants.map((t) => (
        <div key={t.id} className={`toast ${t.tone ? `toast-${t.tone}` : ''}`}>
          <span className="toast-msg">{t.message}</span>
          {t.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                t.undo!()
                retirerToast(t.id)
              }}
            >
              Annuler
            </button>
          )}
          <button className="toast-x" onClick={() => retirerToast(t.id)} aria-label="Fermer">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- boutons ----------

export function Btn({
  onClick,
  children,
  kind = 'default',
  small,
  disabled,
  title,
  type = 'button',
}: {
  onClick?: () => void
  children: ReactNode
  kind?: 'default' | 'primary' | 'ghost' | 'danger'
  small?: boolean
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      className={`btn btn-${kind} ${small ? 'btn-small' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

/** bouton « copier dans le presse-papier » avec retour visuel */
export function CopyBtn({
  text,
  label = 'Copier',
  kind = 'primary',
  small,
  onCopied,
}: {
  text: string | (() => string)
  label?: string
  kind?: 'default' | 'primary' | 'ghost'
  small?: boolean
  /** effet de bord après copie réussie (ex. tracer une relance) */
  onCopied?: () => void
}) {
  const [fait, setFait] = useState(false)
  return (
    <Btn
      kind={fait ? 'default' : kind}
      small={small}
      onClick={async () => {
        const t = typeof text === 'function' ? text() : text
        if (await copier(t)) {
          setFait(true)
          onCopied?.()
          setTimeout(() => setFait(false), 1800)
        }
      }}
    >
      {fait ? '✓ Copié !' : label}
    </Btn>
  )
}

// ---------- formulaires ----------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  style?: CSSProperties
}) {
  return (
    <input
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
    />
  )
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  mono?: boolean
}) {
  return (
    <textarea
      className={`input ${mono ? 'mono' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
    />
  )
}

/** saisie numérique tolérante (virgule, espaces) ; null = vide */
export function NumInput({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  style?: CSSProperties
}) {
  const [texte, setTexte] = useState(value === null ? '' : String(value))
  useEffect(() => {
    // resynchronise si la valeur change de l'extérieur
    const actuel = parseNum(texte)
    if (actuel !== value) setTexte(value === null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      className="input num"
      inputMode="decimal"
      value={texte}
      placeholder={placeholder}
      style={style}
      onChange={(e) => {
        setTexte(e.target.value)
        onChange(parseNum(e.target.value))
      }}
    />
  )
}

export function DateInput({
  value,
  onChange,
  style,
}: {
  value: string | null
  onChange: (v: string | null) => void
  style?: CSSProperties
}) {
  return (
    <input
      className="input"
      type="date"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={style}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  style,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  style?: CSSProperties
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---------- modal & onglets ----------

export function Modal({
  titre,
  onClose,
  children,
  large,
}: {
  titre: string
  onClose: () => void
  children: ReactNode
  large?: boolean
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${large ? 'modal-large' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>{titre}</h2>
          <button className="btn btn-ghost btn-small" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Tabs({
  tabs,
  actif,
  onSelect,
}: {
  tabs: { id: string; label: ReactNode }[]
  actif: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab ${t.id === actif ? 'tab-active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------- tableau simple ----------

export function Table({
  head,
  children,
  compact,
}: {
  head: ReactNode[]
  children: ReactNode
  compact?: boolean
}) {
  return (
    <div className="table-wrap">
      <table className={`table ${compact ? 'table-compact' : ''}`}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
