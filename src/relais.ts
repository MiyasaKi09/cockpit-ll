// Client du relais Vercel (api/relais.js) — permet d'atteindre les
// plateformes AO sans CORS (TED, AWS…). N'existe que sur le site
// déployé : en local, la veille BOAMP directe continue de marcher.

let dispo: boolean | null = null

/** le relais répond-il ? (mémorisé pour la session) */
export async function relaisDisponible(): Promise<boolean> {
  if (dispo !== null) return dispo
  try {
    const r = await fetch('/api/relais?ping=1')
    const j = (await r.json()) as { ok?: boolean }
    dispo = r.ok && j.ok === true
  } catch {
    dispo = false
  }
  return dispo
}

/** fait passer une requête par le relais ; lève une Error lisible */
export async function viaRelais(
  url: string,
  init?: { method?: 'GET' | 'POST'; body?: string; contentType?: string },
): Promise<string> {
  const r = await fetch(`/api/relais?url=${encodeURIComponent(url)}`, {
    method: init?.method || 'GET',
    headers: init?.body ? { 'Content-Type': init.contentType || 'application/json' } : undefined,
    body: init?.body,
  })
  const texte = await r.text()
  if (!r.ok) {
    let message = `Relais : HTTP ${r.status}.`
    try {
      const j = JSON.parse(texte) as { erreur?: string }
      if (j.erreur) message = j.erreur
    } catch {
      // corps non JSON : on garde le message générique
    }
    throw new Error(message)
  }
  return texte
}
