// Routines Claude & imports — le « hook » du sans-API : les
// routines tournent à heure fixe dans Claude (Gmail/Drive/web),
// l'intranet n'appelle jamais d'API. On configure une fois le
// prompt de routine ; ensuite seuls les résultats (bloc JSON)
// font l'aller-retour, collés dans l'import ci-dessous.

import { useState } from 'react'
import { useStore } from '../store'
import { ROUTINES } from '../routines'
import {
  parseRetourRoutine,
  importerSituations,
  importerConsultations,
  importerCourriers,
  type RetourRoutine,
  type ResultatImport,
} from '../importRoutines'
import { Badge, Btn, Card, CopyBtn, TextArea } from '../ui'

export function RoutinesContenu() {
  return (
    <>
      <ImportUniversel />

      {ROUTINES.map((r) => (
        <Card
          key={r.id}
          titre={
            <>
              {r.titre} <Badge tone="info">{r.frequence}</Badge>
              {r.importCible && <Badge tone="muted">import : {r.importCible}</Badge>}
            </>
          }
          actions={<CopyBtn text={r.promptRoutine} label="Copier le prompt de routine" />}
        >
          <p className="small" style={{ maxWidth: '75ch' }}>
            {r.description}
          </p>
          <details style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
              Voir le prompt complet
            </summary>
            <pre style={{ marginTop: 8 }}>{r.promptRoutine}</pre>
          </details>
        </Card>
      ))}

      <Card titre="Première mise en place">
        <p className="small" style={{ maxWidth: '75ch' }}>
          Créer les Projets Claude et programmer chaque routine se fait une seule fois.
          La marche à suivre complète est dans{' '}
          <a href="#/demarrer">Bien démarrer</a>.
        </p>
      </Card>
    </>
  )
}

function ImportUniversel() {
  const { state, update } = useStore()
  const [brut, setBrut] = useState('')
  const [apercu, setApercu] = useState<RetourRoutine | null>(null)
  const [erreur, setErreur] = useState('')
  const [resultat, setResultat] = useState<{ type: string; res: ResultatImport } | null>(null)

  const analyser = () => {
    setResultat(null)
    const { retour, erreur } = parseRetourRoutine(brut)
    if (erreur) {
      setApercu(null)
      setErreur(erreur)
    } else {
      setErreur('')
      setApercu(retour!)
    }
  }

  const importer = () => {
    if (!apercu) return
    let res: ResultatImport = { ajoutes: 0, doublons: 0, nonRattaches: 0 }
    update((d) => {
      res =
        apercu.type === 'situations'
          ? importerSituations(d, apercu.items)
          : apercu.type === 'courriers'
            ? importerCourriers(d, apercu.items)
            : importerConsultations(d, apercu.items)
    })
    setResultat({ type: apercu.type, res })
    setApercu(null)
    setBrut('')
  }

  return (
    <Card titre="Import universel — coller le retour d'une routine">
      <TextArea
        value={brut}
        onChange={setBrut}
        rows={6}
        mono
        placeholder='Collez ici la réponse de la routine (le bloc ```json``` est détecté automatiquement, le texte autour est ignoré)…'
      />
      <div className="form-foot">
        <Btn kind="primary" onClick={analyser} disabled={!brut.trim()}>
          Analyser
        </Btn>
      </div>

      {erreur && <p className="danger-text small">{erreur}</p>}

      {apercu && (
        <div style={{ marginTop: 10 }}>
          <p className="small">
            <Badge tone="info">{apercu.type}</Badge> {apercu.items.length} élément
            {apercu.items.length > 1 ? 's' : ''} détecté{apercu.items.length > 1 ? 's' : ''} :
          </p>
          <ul className="small" style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
            {apercu.items.slice(0, 8).map((it, i) => (
              <li key={i}>
                {'entreprise' in it
                  ? `${it.entreprise} — ${it.mois}${it.montantMoisHT != null ? ` — ${it.montantMoisHT} € HT` : ''}`
                  : 'objet' in it
                    ? `${it.objet} — ${it.de}${it.projet ? ` (${it.projet})` : ''}`
                    : `${it.intitule}${it.acheteur ? ` — ${it.acheteur}` : ''}`}
              </li>
            ))}
            {apercu.items.length > 8 && <li>… et {apercu.items.length - 8} de plus</li>}
          </ul>
          <Btn kind="primary" onClick={importer}>
            Importer {apercu.items.length} élément{apercu.items.length > 1 ? 's' : ''}
          </Btn>
        </div>
      )}

      {resultat && (
        <p className="small" style={{ marginTop: 10 }}>
          <Badge tone="ok">Import terminé</Badge> {resultat.res.ajoutes} ajouté
          {resultat.res.ajoutes > 1 ? 's' : ''}, {resultat.res.doublons} doublon
          {resultat.res.doublons > 1 ? 's' : ''} ignoré{resultat.res.doublons > 1 ? 's' : ''}
          {resultat.type === 'situations' && resultat.res.nonRattaches > 0 && (
            <> , {resultat.res.nonRattaches} à rattacher à un marché</>
          )}{' '}
          →{' '}
          <a href={resultat.type === 'situations' ? '#/situations' : resultat.type === 'courriers' ? '#/' : '#/ao'}>
            ouvrir {resultat.type === 'situations' ? 'Situations' : resultat.type === 'courriers' ? 'le Cockpit (À traiter)' : 'Veille AO'}
          </a>
        </p>
      )}
      {state.marches.length === 0 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Astuce : renseignez les marchés de travaux dans les fiches projets pour que le rapprochement
          automatique (entreprise / lot → marché) fonctionne à l'import.
        </p>
      )}
    </Card>
  )
}
