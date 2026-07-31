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
// Code projet lisible et adresse dédiée (CDC §3.4, §3.10, §12.1)
// ------------------------------------------------------------

/** Prochain code projet lisible pour l'année donnée, format `AAAA-NNN`
 *  (CDC §3.10). C'est une PROPOSITION pré-remplie dans l'assistant, rien
 *  de plus : le code reste modifiable à la saisie, l'identifiant interne
 *  (`P01`) ne bouge pas, et aucun calcul ne s'appuie dessus.
 *
 *  La suite ne se lit que sur les codes de la MÊME année et du même
 *  format. Un code d'un autre format est ignoré plutôt que réinterprété :
 *  proposer un numéro déjà pris est visible à l'écran et se corrige en
 *  deux secondes, alors qu'une numérotation maison mal comprise se
 *  découvrirait chez le client. `annee` est passée par l'appelant (jamais
 *  `new Date()` ici) pour que la fonction reste pure et testable. */
export function codeExternePropose(codesExistants: readonly (string | null | undefined)[], annee: string): string {
  const an = (annee || '').trim().slice(0, 4)
  if (!/^\d{4}$/.test(an)) return ''
  let dernier = 0
  for (const code of codesExistants) {
    const m = /^(\d{4})-(\d{1,4})$/.exec((code || '').trim())
    if (m && m[1] === an) dernier = Math.max(dernier, Number(m[2]))
  }
  return `${an}-${String(dernier + 1).padStart(3, '0')}`
}

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

/** L'identifiant Gmail derrière une référence de source, quelle que soit la
 *  forme sous laquelle le dépôt la garde. Il y en a quatre, et elles ne sont
 *  pas interchangeables au premier regard :
 *
 *    - l'identifiant nu — `EntrantDistant.sourceMessageId` (`src/entrants.ts`),
 *      `Communication.gmailMessageId` (`src/communications.ts`) ;
 *    - `gmail:<id>` — `Courrier.source`, écrit par `src/surveillance.ts` ;
 *    - l'URL déjà construite — `DocumentRecord.sourceUrl`, `NoteJournal.source`,
 *      figées au moment du classement ;
 *    - du texte qui ne désigne aucun message (« routine tri du matin », une
 *      adresse, un chemin de fichier) — la moitié des `Courrier` du dépôt.
 *
 *  Rendre `null` sur le dernier cas est le point : un lien mort vers Gmail se
 *  découvre en cliquant, une source dite absente se voit tout de suite. */
function identifiantGmailDe(source: string | null | undefined): string | null {
  const brut = (source || '').trim()
  if (!brut) return null
  // une URL Gmail porte l'identifiant en dernier segment de son fragment
  const candidat = brut.includes('://') || brut.startsWith('#')
    ? brut.slice(brut.lastIndexOf('/') + 1)
    : brut.replace(/^gmail:/i, '')
  return candidat || null
}

/** « Ouvrir dans Gmail » (CDC §4.2), depuis n'importe laquelle de ces formes.
 *  Passe par `gmailMessageUrl`, qui reste le SEUL constructeur d'URL Gmail du
 *  dépôt — `scripts/test-oauth-lecture-seule.cjs` le vérifie fichier par
 *  fichier, et c'est ce qui garde le périmètre Google en lecture seule. */
export function lienGmail(source: string | null | undefined): string | null {
  return gmailMessageUrl(identifiantGmailDe(source) || '')
}
