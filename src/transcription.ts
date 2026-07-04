// ============================================================
// Transcription audio DANS le navigateur — Whisper (open source)
// via transformers.js : gratuit, hors-ligne après le premier
// chargement du modèle, l'audio ne quitte jamais la machine.
// WebGPU si disponible, sinon WASM (plus lent).
// ============================================================

export interface ProgresTranscription {
  etape: string
  /** 0..100 si connu */
  pct?: number | null
}

export const MODELES_WHISPER = [
  { id: 'onnx-community/whisper-small', label: 'Standard (small — bon français, ~250 Mo)' },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Très précis (large-v3-turbo — ~600 Mo, machine récente conseillée)' },
  { id: 'onnx-community/whisper-base', label: 'Rapide (base — dépannage, qualité moyenne)' },
]

let chargement: Promise<unknown> | null = null
let modeleCharge = ''

async function getPipeline(modele: string, onProgres: (p: ProgresTranscription) => void) {
  if (!chargement || modeleCharge !== modele) {
    modeleCharge = modele
    chargement = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const webgpu = 'gpu' in navigator
      onProgres({ etape: `Chargement du modèle (${webgpu ? 'WebGPU' : 'WASM'}) — mis en cache après le 1er usage…` })
      return pipeline('automatic-speech-recognition', modele, {
        device: webgpu ? 'webgpu' : 'wasm',
        dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
          if (info.status === 'progress' && typeof info.progress === 'number') {
            onProgres({ etape: `Téléchargement du modèle (${info.file || ''})`, pct: Math.round(info.progress) })
          }
        },
      })
    })()
    // un échec (hors-ligne…) ne doit pas empoisonner les tentatives suivantes
    chargement.catch(() => {
      chargement = null
    })
  }
  return chargement
}

/** décode le fichier audio en mono 16 kHz (le taux d'échantillonnage de Whisper) */
async function decoderAudio(file: File, onProgres: (p: ProgresTranscription) => void): Promise<Float32Array> {
  onProgres({ etape: 'Décodage du fichier audio…' })
  const buf = await file.arrayBuffer()
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx({ sampleRate: 16000 })
  try {
    const audio = await ctx.decodeAudioData(buf)
    if (audio.numberOfChannels === 1) return audio.getChannelData(0)
    // mixage mono
    const g = audio.getChannelData(0)
    const d = audio.getChannelData(1)
    const mono = new Float32Array(g.length)
    for (let i = 0; i < g.length; i++) mono[i] = (g[i] + d[i]) / 2
    return mono
  } finally {
    void ctx.close()
  }
}

/**
 * Transcrit un fichier audio (réunion de chantier…) entièrement en local.
 * Pour les très longues réunions (> ~1 h 30), préférer un enregistrement
 * mono compressé, ou couper le fichier en deux.
 */
export async function transcrireFichier(
  file: File,
  modele: string,
  onProgres: (p: ProgresTranscription) => void,
): Promise<string> {
  const audio = await decoderAudio(file, onProgres)
  const dureeMin = Math.round(audio.length / 16000 / 60)
  const asr = (await getPipeline(modele, onProgres)) as (
    entree: Float32Array,
    options: Record<string, unknown>,
  ) => Promise<{ text: string } | { text: string }[]>

  onProgres({
    etape: `Transcription en cours (~${dureeMin} min d'audio) — laissez l'onglet ouvert, tout se passe sur votre machine…`,
  })
  const sortie = await asr(audio, {
    language: 'french',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  })
  const texte = Array.isArray(sortie) ? sortie.map((s) => s.text).join(' ') : sortie.text
  return texte.trim()
}

/**
 * Test de santé : charge le modèle (téléchargé puis mis en cache) et fait
 * une inférence sur 1 s de silence. Si ça passe, la transcription d'une
 * vraie réunion passera aussi — même moteur, même chemin.
 */
export async function testerModele(
  modele: string,
  onProgres: (p: ProgresTranscription) => void,
): Promise<void> {
  const asr = (await getPipeline(modele, onProgres)) as (
    entree: Float32Array,
    options: Record<string, unknown>,
  ) => Promise<unknown>
  onProgres({ etape: 'Modèle chargé — inférence d’essai…' })
  await asr(new Float32Array(16000), { language: 'french', task: 'transcribe' })
}
