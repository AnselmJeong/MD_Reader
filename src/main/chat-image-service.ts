import { nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chatImageBytes, validateChatImages, MAX_CHAT_IMAGE_DIMENSION, MAX_CHAT_REQUEST_IMAGE_BYTES, type ChatImage } from '../shared/chat-images'
import type { ChatMessageInput } from './ai-chat-types'

export function decodeChatImage(image: ChatImage): Buffer {
  const decoded = nativeImage.createFromDataURL(image.dataUrl)
  const size = decoded.getSize()
  if (decoded.isEmpty() || size.width > MAX_CHAT_IMAGE_DIMENSION || size.height > MAX_CHAT_IMAGE_DIMENSION) {
    throw new Error('이미지를 읽을 수 없거나 해상도가 너무 큽니다. 4096px 이하의 이미지를 첨부해 주세요.')
  }
  return Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64')
}

export function validateChatImageMessages(messages: ChatMessageInput[]): void {
  let bytes = 0
  for (const message of messages) {
    const images = validateChatImages(message.images)
    if (images.length && message.role !== 'user') throw new Error('이미지는 사용자 질문에만 첨부할 수 있습니다.')
    for (const image of images) {
      bytes += chatImageBytes(image.dataUrl)
      if (bytes > MAX_CHAT_REQUEST_IMAGE_BYTES) throw new Error('이 대화의 이미지가 30MB를 초과합니다. 새 대화에서 질문해 주세요.')
      decodeChatImage(image)
    }
  }
}

export async function writeChatExport(filePath: string, markdown: string, images: ChatImage[] = []): Promise<void> {
  let output = markdown
  const folder = `${path.basename(filePath, path.extname(filePath))}.assets`
  for (const image of images) {
    validateChatImages([image])
    const bytes = decodeChatImage(image)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const extension = image.dataUrl.startsWith('data:image/jpeg;') ? 'jpg' : image.dataUrl.startsWith('data:image/webp;') ? 'webp' : 'png'
    await fs.mkdir(path.join(path.dirname(filePath), folder), { recursive: true })
    await fs.writeFile(path.join(path.dirname(filePath), folder, `${hash}.${extension}`), bytes)
    output = output.replaceAll(`mdr-chat-image:${image.id}`, `${encodeURIComponent(folder)}/${hash}.${extension}`)
  }
  await fs.writeFile(filePath, output, 'utf-8')
}
