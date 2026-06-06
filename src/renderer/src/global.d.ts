import type { ElectronAPI } from '../../preload/index'
export type {
  ChatContextMeta,
  ChatSessionRecord,
  ChatSessionSummary,
  ChatMessageRole,
  DocumentKind,
  FileReadResult,
  SessionTitleStatus,
  StoredChatMessage,
  TtsMode,
  TtsSpeakParams,
  TtsState,
  TtsStatus,
  TtsUtterance,
  TtsUtteranceEvent
} from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
