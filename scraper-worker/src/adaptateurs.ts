// ============================================================
// Adaptateurs du worker navigateur — MÊME contrat de sortie que
// veille-enrichir (extraction par libellés français), avec en plus
// le sélecteur d'ÉTAT MÉTIER à attendre avant d'extraire.
// Un adaptateur par famille ; la configuration par site reste
// séparée du code (audit §7.5).
// ============================================================

export interface FicheExtraite {
  reference?: string
  titre?: string
  objet?: string
  acheteur?: string
  procedure?: string
  lieu?: string
  dateLimite?: string
  dceAccess?: 'public' | 'form' | 'login' | 'unknown'
  dceUrl?: string
}

export interface AdaptateurWorker {
  id: string
  canHandle(url: string): boolean
  /** sélecteur attendu avant extraction — un état métier, pas un délai */
  selecteurPret: string
  parseDetail(html: string, urlFinale: string): FicheExtraite
}

function lignesDe(html: string): string[] {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/td|\/li|\/h[1-6]|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)
}

function valeurApresLibelle(lignes: string[], motif: RegExp, maxLg = 300): string | undefined {
  for (let i = 0; i < lignes.length; i++) {
    const m = motif.exec(lignes[i])
    if (!m) continue
    const reste = lignes[i].slice(m.index + m[0].length).replace(/^\s*:?\s*/, '').trim()
    if (reste && reste.length >= 2) return reste.slice(0, maxLg)
    for (let j = i + 1; j <= i + 2 && j < lignes.length; j++) {
      const v = lignes[j].trim()
      if (v && v.length >= 2) return v.slice(0, maxLg)
    }
  }
  return undefined
}

function versISO(s: string | undefined): string | undefined {
  if (!s) return undefined
  const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s)
  if (!m) return undefined
  const a = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** extraction commune par libellés (identique à veille-enrichir) */
function extraireParLibelles(html: string): FicheExtraite {
  const lignes = lignesDe(html)
  return {
    titre: valeurApresLibelle(lignes, /^(Intitul[ée]|Objet)( du march[ée])?\s*(:|$)/i, 250),
    objet: valeurApresLibelle(lignes, /^Objet( du march[ée])?\s*(:|$)/i, 500),
    acheteur: valeurApresLibelle(lignes, /^(Organisme|Acheteur|Client|Collectivit[ée]|Entit[ée] publique)\s*(:|$)/i, 160),
    reference: valeurApresLibelle(lignes, /^R[ée]f[ée]rence\s*(:|$)/i, 60),
    procedure: valeurApresLibelle(lignes, /^(Proc[ée]dure|Type de proc[ée]dure|Mode de passation)\s*(:|$)/i, 120),
    lieu: valeurApresLibelle(lignes, /^(Lieu d.ex[ée]cution|D[ée]partement|Localisation)\s*(:|$)/i, 160),
    dateLimite: versISO(
      valeurApresLibelle(lignes, /(date (et heure )?limite|remise des (offres|plis|candidatures)|cl[ôo]ture)/i, 80),
    ),
  }
}

export const ADAPTATEURS: AdaptateurWorker[] = [
  {
    id: 'aws',
    canHandle: (url) => /marches-publics\.info|aws-france\.com/i.test(url),
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
  {
    id: 'atexo-compatible', // PLACE, Maximilien, Mégalis, Ternum BFC
    canHandle: (url) =>
      ['marches-publics.gouv.fr', 'maximilien.fr', 'megalis.bretagne.bzh', 'ternum-bfc.fr'].some((d) =>
        url.includes(d),
      ),
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
  {
    id: 'e-marchespublics',
    canHandle: (url) => /e-marchespublics\.com|dematis\.com/i.test(url),
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
  {
    id: 'marches-securises',
    canHandle: (url) => /marches-securises\.fr/i.test(url),
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
  {
    id: 'klekoon',
    canHandle: (url) => /klekoon\.com/i.test(url),
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
  {
    id: 'generique',
    canHandle: () => true,
    selecteurPret: 'body',
    parseDetail: (html) => extraireParLibelles(html),
  },
]
