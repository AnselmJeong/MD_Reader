import type { ElectronAPI } from '../../preload/index'
export type {
  ChatContextMeta,
  ChatCompletionMetadata,
  ChatSessionRecord,
  ChatSessionSummary,
  ChatSource,
  ChatMessageRole,
  AiProviderStatus,
  AgentMemoryStatus,
  DocumentKind,
  EpubAnnotationKind,
  EpubAnnotationRecord,
  EpubAnnotationStyle,
  EpubReadingProgressRecord,
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
