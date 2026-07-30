const VERSION_JETON = 1
const DUREE_JETON_MS = 10 * 60 * 1000

interface ChargeUtileInitiation {
  v: number
  appelant: string
  compte: string
  exp: number
  nonce: string
}

function versBase64Url(octets: Uint8Array): string {
  let binaire = ''
  for (const octet of octets) binaire += String.fromCharCode(octet)
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function depuisBase64Url(valeur: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(valeur)) throw new Error('Base64url invalide.')
  const complete = valeur.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(valeur.length / 4) * 4, '=')
  const binaire = atob(complete)
  return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0))
}

async function signer(message: string, secret: string): Promise<Uint8Array> {
  const encodeur = new TextEncoder()
  const cle = await crypto.subtle.importKey(
    'raw',
    encodeur.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cle, encodeur.encode(message)))
}

function comparaisonConstante(a: Uint8Array, b: Uint8Array): boolean {
  let ecart = a.byteLength ^ b.byteLength
  const longueur = Math.max(a.byteLength, b.byteLength)
  for (let i = 0; i < longueur; i++) {
    ecart |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return ecart === 0
}

export async function creerJetonInitiationOAuth(
  appelant: string,
  compte: string,
  secret: string,
  maintenant = Date.now(),
): Promise<string> {
  if (secret.length < 32) throw new Error('Secret de signature OAuth absent ou trop court.')
  const charge: ChargeUtileInitiation = {
    v: VERSION_JETON,
    appelant: appelant.trim().toLowerCase(),
    compte: compte.trim().toLowerCase(),
    exp: maintenant + DUREE_JETON_MS,
    nonce: crypto.randomUUID(),
  }
  const corps = versBase64Url(new TextEncoder().encode(JSON.stringify(charge)))
  return `${corps}.${versBase64Url(await signer(corps, secret))}`
}

export async function verifierJetonInitiationOAuth(
  jeton: string | null,
  compteAttendu: string,
  secret: string,
  maintenant = Date.now(),
): Promise<boolean> {
  try {
    if (!jeton || secret.length < 32 || jeton.length > 2048) return false
    const morceaux = jeton.split('.')
    if (morceaux.length !== 2) return false
    const [corps, signatureEncodee] = morceaux
    const signatureRecue = depuisBase64Url(signatureEncodee)
    const signatureAttendue = await signer(corps, secret)
    if (!comparaisonConstante(signatureRecue, signatureAttendue)) return false

    const charge = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(depuisBase64Url(corps))) as
      Partial<ChargeUtileInitiation>
    const compte = compteAttendu.trim().toLowerCase()
    return (
      charge.v === VERSION_JETON &&
      typeof charge.appelant === 'string' &&
      charge.appelant.length > 3 &&
      charge.compte === compte &&
      typeof charge.exp === 'number' &&
      charge.exp >= maintenant &&
      charge.exp <= maintenant + DUREE_JETON_MS &&
      typeof charge.nonce === 'string' &&
      charge.nonce.length >= 16
    )
  } catch {
    return false
  }
}
