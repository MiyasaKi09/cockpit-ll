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
import { Badge, Btn, Card, CopyBtn, Page, TextArea } from '../ui'

export default function Routines() {
  return (
    <Page
      titre="Routines Claude & imports"
      sousTitre="Configurées une fois dans Claude (routines programmées, accès Gmail/Drive/web), elles tournent sans intervention. Le Cockpit n'appelle jamais d'API : seuls les résultats font l'aller-retour — et l'humain valide toujours."
    >
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
              Voir le prompt complet{r.formatJSON ? ' et le contrat JSON' : ''}
            </summary>
            <pre style={{ marginTop: 8 }}>{r.promptRoutine}</pre>
          </details>
        </Card>
      ))}

      <Card titre="Mode d'emploi (une fois pour toutes)">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            Créer les <strong>Projets Claude</strong> : « CR de chantier » (template + intervenants),
            « Analyse AO » (critères de l'agence), « Secrétariat » (ton, signatures), « Matériauthèque »
            (vocabulaire de tags) — les instructions permanentes n'y sont jamais retapées.
          </li>
          <li>
            Créer les <strong>routines programmées</strong> ci-dessus dans Claude (copier chaque prompt tel
            quel, régler l'horaire, autoriser Gmail/Drive/recherche web).
          </li>
          <li>
            Côté Gmail : ouvrir <strong>situations@agence-ll.fr</strong> (à imposer dans les marchés) et poser
            les filtres natifs Administratif / Chantier / Client.
          </li>
          <li>
            Au quotidien : lire le digest du matin dans Claude ; quand une routine produit un bloc JSON, le
            coller dans l'import ci-dessus (ou dans le module concerné) — les lignes arrivent
            <strong> « à vérifier »</strong>, jamais validées toutes seules.
          </li>
        </ol>
        <p className="small muted" style={{ marginTop: 10 }}>
          Limites assumées du sans-API : pas d'automatisation en tâche de fond hors routines planifiées, un
          geste de copier-coller subsiste sur les flux ponctuels. À deux, c'est un avantage déguisé — chaque
          sortie est relue. Le jour où l'agence grandit, la bascule est propre : les pré-prompts deviennent
          des appels API, la base et les règles ne changent pas.
        </p>
      </Card>
    </Page>
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
