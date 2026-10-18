import { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_DIMENSION, type ChatImage } from '../../../../../shared/chat-images'

export async function readChatImage(file: File): Promise<ChatImage> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('PNG, JPEG, WebP 또는 GIF 이미지를 첨부해 주세요.')
  if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error(`${file.name}: 이미지는 한 장에 10MB까지 첨부할 수 있습니다.`)
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name}: 이미지 파일을 읽을 수 없습니다.`) })
  try {
    const ratio = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('이미지를 준비하지 못했습니다.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('이미지를 변환하지 못했습니다.')), 'image/png'))
    if (blob.size > MAX_CHAT_IMAGE_BYTES) throw new Error(`${file.name}: 이미지가 너무 큽니다. 필요한 부분만 캡처해 주세요.`)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
      reader.readAsDataURL(blob)
    })
    return { id: crypto.randomUUID(), name: (file.name || '스크린샷.png').slice(0, 180), dataUrl }
  } finally { bitmap.close() }
}
