// Kit UI partagé — composants sobres, cohérents sur tous les modules.

import { useEffect, useState } from 'react'
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
