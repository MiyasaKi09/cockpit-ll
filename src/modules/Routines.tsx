// Routines Claude & imports — le « hook » du sans-API : les
// routines tournent à heure fixe dans Claude (Gmail/Drive/web),
// l'intranet n'appelle jamais d'API. On configure une fois le
// prompt de routine ; ensuite seuls les résultats (bloc JSON)
// font l'aller-retour, collés dans l'import ci-dessous.

import { useState } from 'react'
import { useStore } from '../store'
import { ROUTINES, gabaritRoutine, idPromptRoutine, routineEffective, type RoutineSpec } from '../routines'
import {
  parseRetourRoutine,
  importerSituations,
  importerConsultations,
  importerCourriers,
  type RetourRoutine,
  type ResultatImport,
} from '../importRoutines'
import { Badge, Btn, Card, CopyBtn, Field, Modal, TextArea, confirmer, toast } from '../ui'
import { fmtDate, todayISO } from '../util'

export function RoutinesContenu() {
  return (
    <>
      <ImportUniversel />

      {ROUTINES.map((r) => (
        <CarteRoutine key={r.id} spec={r} />
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

// ============================================================
// Une routine se lit, se copie — et se MODIFIE (§3.2, lot E3).
// Zone d'intervention, fourchette de budget, adresse dédiée, prénoms :
// ces critères changent au rythme de l'agence, pas des livraisons de
// code. L'adaptation vit dans `state.prompts` sous un identifiant
// stable ; l'écran ne connaît que « le corps effectif », et le modèle
// livré reste toujours à un clic.
// ============================================================

function CarteRoutine({ spec }: { spec: RoutineSpec }) {
  const { state } = useStore()
  const [edition, setEdition] = useState(false)
  const eff = routineEffective(spec, state.prompts)

  return (
    <Card
      titre={
        <>
          {spec.titre} <Badge tone="info">{spec.frequence}</Badge>
          {spec.importCible && <Badge tone="muted">import : {spec.importCible}</Badge>}
          {eff.adaptee && (
            <Badge tone="ok">
              adaptée par l'agence — v{eff.version}
              {eff.majLe ? `, ${fmtDate(eff.majLe)}` : ''}
            </Badge>
          )}
        </>
      }
      actions={
        <>
          <Btn small onClick={() => setEdition(true)}>
            Modifier les critères
          </Btn>{' '}
          <CopyBtn text={eff.corps} label="Copier le prompt de routine" />
        </>
      }
    >
      <p className="small" style={{ maxWidth: '75ch' }}>
        {spec.description}
      </p>
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
          Voir le prompt complet
        </summary>
        <pre style={{ marginTop: 8 }}>{eff.corps}</pre>
      </details>
      {edition && <ModaleRoutine spec={spec} onClose={() => setEdition(false)} />}
    </Card>
  )
}

function ModaleRoutine({ spec, onClose }: { spec: RoutineSpec; onClose: () => void }) {
  const { state, update, replace } = useStore()
  const eff = routineEffective(spec, state.prompts)
  const [corps, setCorps] = useState(eff.corps)

  const enregistrer = () => {
    const snap = state
    update((d) => {
      const i = d.prompts.findIndex((t) => t.id === idPromptRoutine(spec.id))
      const maj = gabaritRoutine(spec, corps, todayISO(), i >= 0 ? d.prompts[i] : null)
      if (i >= 0) d.prompts[i] = maj
      else d.prompts.push(maj)
    })
    toast(`Routine « ${spec.titre} » enregistrée (v${eff.version + 1}) — à recopier dans la tâche Claude.`, {
      tone: 'ok',
      undo: () => replace(snap),
    })
    onClose()
  }

  const retablir = async () => {
    const ok = await confirmer({
      message: `Rétablir le modèle d'origine de « ${spec.titre} » ?\n\nLes critères saisis par l'agence (v${eff.version}) seront perdus.`,
      danger: true,
      confirmerLabel: 'Rétablir le modèle',
    })
    if (!ok) return
    const snap = state
    update((d) => {
      d.prompts = d.prompts.filter((t) => t.id !== idPromptRoutine(spec.id))
    })
    toast("Modèle d'origine rétabli.", { undo: () => replace(snap) })
    onClose()
  }

  return (
    <Modal titre={`Modifier — ${spec.titre}`} onClose={onClose} large>
      <p className="small" style={{ maxWidth: '75ch', marginTop: 0 }}>
        Les critères qui vivent — zone d'intervention, typologies, fourchette de budget, adresse dédiée,
        prénoms — sont dans ce texte : ils se modifient ici, sans développeur.
      </p>
      <div className="pill-note">
        L'outil ne touche jamais à votre tâche programmée : après enregistrement, recopiez le prompt
        (bouton « Copier ») dans la routine Claude pour qu'elle en tienne compte.
      </div>
      <Field label="Prompt de la routine">
        <TextArea value={corps} onChange={setCorps} rows={18} mono />
      </Field>
      <div className="form-foot">
        {eff.adaptee && (
          <Btn kind="ghost" onClick={() => void retablir()}>
            Rétablir le modèle
          </Btn>
        )}
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!corps.trim() || corps === eff.corps}
          onClick={enregistrer}
        >
          Enregistrer (v{eff.version + 1})
        </Btn>
      </div>
    </Modal>
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
