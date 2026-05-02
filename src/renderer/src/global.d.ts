import type { ElectronAPI } from '../../preload/index'
export type { TtsMode, TtsSpeakParams, TtsState, TtsStatus, TtsUtterance, TtsUtteranceEvent } from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
