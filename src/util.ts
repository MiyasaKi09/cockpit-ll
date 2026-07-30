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

// ------------------------------------------------------------
// Adresse dédiée d'un projet (CDC §3.4, §12.1)
// ------------------------------------------------------------

/** Domaine retenu par l'agence. Il n'est PAS acheté : il ne sert qu'à
 *  proposer une adresse dans un formulaire. Rien, nulle part, ne doit
 *  dépendre de son existence — la validation ci-dessous accepte d'ailleurs
 *  n'importe quel domaine. */
export const DOMAINE_AGENCE = 'agence-ll.fr'

/** Adresse projet proposée à la saisie : `[code-projet]@domaine`.
 *  Simple suggestion affichée en placeholder — le Cockpit ne crée aucune
 *  boîte et n'écrit jamais cette valeur tout seul. */
export function adresseProjetProposee(codeExterne: string | null | undefined, domaine = DOMAINE_AGENCE): string {
  const code = fold(codeExterne || '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return code ? `${code}@${domaine}` : ''
}

/** L'adresse saisie ressemble-t-elle à une adresse exploitable ?
 *  Aucun domaine n'est présumé (même règle que `normaliserEmail`, moi.ts) :
 *  `2026-034@agence-ll.fr` comme `situations@autre-domaine.fr` passent. La
 *  saisie vide est valide — le champ est optionnel. */
export function adresseProjetValide(adresse: string | null | undefined): boolean {
  const v = (adresse || '').trim().toLowerCase()
  if (!v) return true
  return /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v)
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

/** URL Gmail « nouveau message » pré-rempli — l'envoi reste un clic humain */
export function gmailComposeUrl(to: string, sujet: string, corps: string): string {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: sujet, body: corps })
  return `https://mail.google.com/mail/?${p.toString()}`
}

export function ouvrirGmail(to: string, sujet: string, corps: string): void {
  window.open(gmailComposeUrl(to, sujet, corps), '_blank', 'noopener')
}

/** URL qui rouvre un message dans Gmail à partir de son identifiant d'API.
 *  `#all/` plutôt que `#inbox/` : la pièce peut avoir été archivée depuis.
 *  C'est ce lien qui rend le critère 10 vérifiable — une pièce jointe classée
 *  conserve le chemin de retour vers l'échange qui l'a apportée. */
export function gmailMessageUrl(messageId: string): string | null {
  const id = (messageId || '').trim()
  // les identifiants Gmail sont hexadécimaux ; tout le reste viendrait
  // d'une autre source et produirait un lien mort
  if (!/^[0-9a-f]{6,}$/i.test(id)) return null
  return `https://mail.google.com/mail/u/0/#all/${id}`
}
