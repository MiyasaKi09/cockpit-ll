// Utilitaires purs (dates, formats, identifiants) — aucune dépendance.

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 'AAAA-MM-JJ' + n jours */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** écart en jours (b − a) */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000)
}

/** lundi de la semaine contenant la date */
export function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const day = d.getDay() // 0 = dimanche
  d.setDate(d.getDate() - ((day + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** 'AAAA-MM' du mois de la date */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** 'AAAA-MM' + n mois */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  const ny = Math.floor(t / 12)
  const nm = (t % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

const moneyFmt = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const moneyFmtCents = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function fmtMoney(v: number | null | undefined, cents = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return cents ? moneyFmtCents.format(v) : moneyFmt.format(v)
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return (v * 100).toFixed(digits).replace('.', ',') + ' %'
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
  if (Number.isNaN(d.getTime())) return iso
  return dateFmt.format(d)
}

export function fmtMois(ym: string | null | undefined): string {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  const i = Number(m) - 1
  return i >= 0 && i < 12 ? `${noms[i]} ${y}` : ym
}

export function fmtHeures(h: number | null | undefined): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '—'
  return `${Math.round(h * 10) / 10} h`
}

/** parse un nombre saisi (accepte virgule française, espaces) */
export function parseNum(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const v = Number(t)
  return Number.isNaN(v) ? null : v
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** normalise pour comparaison floue (minuscules, sans accents) */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function download(nomFichier: string, contenu: string, type = 'application/json'): void {
  const blob = new Blob([contenu], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  URL.revokeObjectURL(url)
}
