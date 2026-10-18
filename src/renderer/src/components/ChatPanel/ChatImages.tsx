import { useState, useMemo } from 'react'
import type { ChatImage } from '../../../../shared/chat-images'
import { ImageDialog } from '../DocumentReader/EpubImageViewer'

export function ChatImages({ images, onRemove }: { images: ChatImage[]; onRemove?: (id: string) => void }) {
  const [selected, setSelected] = useState<{ image: ChatImage; trigger: Element } | null>(null)
  const dialogImage = useMemo(() => selected ? { src: selected.image.dataUrl, label: selected.image.name, trigger: selected.trigger } : null, [selected])
  return <>
    <div className="chat-image-list" aria-label="첨부 이미지">
      {images.map(image => <div key={image.id} className="chat-image-item">
        <button type="button" className="chat-image-preview" aria-label={`${image.name} 크게 보기`}
          onClick={event => setSelected({ image, trigger: event.currentTarget })}>
          <img src={image.dataUrl} alt={image.name} />
        </button>
        {onRemove && <button type="button" className="chat-image-remove" aria-label={`${image.name} 삭제`} onClick={() => onRemove(image.id)}>×</button>}
      </div>)}
    </div>
    {dialogImage && <ImageDialog image={dialogImage} onClose={() => setSelected(null)} />}
  </>
}
