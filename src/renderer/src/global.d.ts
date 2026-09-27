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
  StoredChatMessage
} from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
