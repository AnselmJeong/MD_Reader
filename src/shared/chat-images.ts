export interface ChatImage {
  id: string
  name: string
  dataUrl: string
}

export type VisionSupport = 'supported' | 'unsupported' | 'unknown'
export interface ModelVisionInfo { model: string; vision: VisionSupport }

export const MAX_CHAT_IMAGES = 4
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_CHAT_REQUEST_IMAGE_BYTES = 30 * 1024 * 1024
export const MAX_CHAT_IMAGE_DIMENSION = 4096

export function chatImageBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
}

export function validateChatImages(value: unknown): ChatImage[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_CHAT_IMAGES) throw new Error(`이미지는 한 질문에 최대 ${MAX_CHAT_IMAGES}장까지 첨부할 수 있습니다.`)
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)
      || ids.has(item.id) || typeof item.name !== 'string' || item.name.length > 180
      || typeof item.dataUrl !== 'string'
      || item.dataUrl.length > MAX_CHAT_IMAGE_BYTES * 4 / 3 + 128
      || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.dataUrl)
      || item.dataUrl.slice(item.dataUrl.indexOf(',') + 1).length % 4 !== 0
      || chatImageBytes(item.dataUrl) === 0 || chatImageBytes(item.dataUrl) > MAX_CHAT_IMAGE_BYTES) {
      throw new Error('이미지는 10MB 이하의 PNG, JPEG 또는 WebP 파일이어야 합니다.')
    }
    ids.add(item.id)
    return { id: item.id, name: item.name, dataUrl: item.dataUrl }
  })
}

export function imageModelWarning(model: string, vision: VisionSupport, historical = false): string {
  if (vision === 'supported') return ''
  if (vision === 'unknown') return `${model}의 이미지 지원 여부를 확인하지 못했습니다. 전송 시 모델에서 거절될 수 있습니다.`
  return `${model}은 이미지 입력을 지원하지 않습니다. Vision 모델로 변경하거나 ${historical ? '이미지가 없는 새 대화를 시작해 주세요.' : '첨부 이미지를 삭제해 주세요.'}`
}
