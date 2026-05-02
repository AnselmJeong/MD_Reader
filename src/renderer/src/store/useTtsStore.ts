import { create } from 'zustand'
import type { TtsMode, TtsState, TtsStatus, TtsUtterance, TtsUtteranceEvent } from '../global'
import { buildDocumentTtsUtterances, buildSelectionTtsUtterance } from '../components/DocumentReader/utils/ttsText'
import { useSettingsStore } from './useSettingsStore'

interface TtsStore {
  mode: TtsMode | null
  state: TtsState
  utterances: TtsUtterance[]
  activeUtteranceId: string | null
  activeUtteranceIndex: number
  error: string | null
  initialized: boolean
  speakDocument: (content: string) => Promise<void>
  speakSelection: (text: string) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  initializeListeners: () => void
}

function applyError(message: string) {
  useTtsStore.setState({ state: 'error', error: message })
}

async function invokeControl(command: 'pause' | 'resume' | 'stop' | 'restart') {
  const result = await window.api.tts[command]()
  if (!result.success) applyError(result.error || `Failed to ${command} TTS`)
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  mode: null,
  state: 'idle',
  utterances: [],
  activeUtteranceId: null,
  activeUtteranceIndex: -1,
  error: null,
  initialized: false,

  speakDocument: async (content) => {
    const current = get()
    if (current.state === 'playing' && current.mode === 'document') {
      await current.pause()
      return
    }
    if (current.state === 'paused' && current.mode === 'document') {
      await current.resume()
      return
    }

    const utterances = buildDocumentTtsUtterances(content)
    const voice = useSettingsStore.getState().ttsVoice
    set({ mode: 'document', state: 'initializing', utterances, activeUtteranceId: null, activeUtteranceIndex: -1, error: null })
    const result = await window.api.tts.speak({ mode: 'document', utterances, voice })
    if (!result.success) applyError(result.error || 'Failed to start document TTS')
  },

  speakSelection: async (text) => {
    const utterances = buildSelectionTtsUtterance(text)
    const voice = useSettingsStore.getState().ttsVoice
    set({ mode: 'selection', state: 'initializing', utterances, activeUtteranceId: null, activeUtteranceIndex: -1, error: null })
    const result = await window.api.tts.speak({ mode: 'selection', utterances, voice })
    if (!result.success) applyError(result.error || 'Failed to start selection TTS')
  },

  pause: async () => invokeControl('pause'),
  resume: async () => invokeControl('resume'),
  stop: async () => invokeControl('stop'),
  restart: async () => invokeControl('restart'),

  initializeListeners: () => {
    if (get().initialized) return
    set({ initialized: true })

    window.api.tts.onStatus((status: TtsStatus) => {
      set((state) => ({
        state: status.state,
        mode: status.mode === undefined ? state.mode : status.mode,
        error: status.state === 'error' ? status.message || state.error : state.error
      }))
    })

    window.api.tts.onUtteranceStart((event: TtsUtteranceEvent) => {
      set({ activeUtteranceId: event.id, activeUtteranceIndex: event.index, state: 'playing' })
    })

    window.api.tts.onUtteranceEnd(() => {
      // The next utterance-start event advances the highlight. Keep the current
      // mark visible between sentences so the reader does not lose orientation.
    })

    window.api.tts.onError((message: string) => {
      applyError(message)
    })
  }
}))
