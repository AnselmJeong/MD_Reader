interface ReadingProgressProps {
  progress: number
}

export function ReadingProgress({ progress }: ReadingProgressProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 h-0.5">
      <div
        className="h-full transition-all duration-150 ease-out"
        style={{
          width: `${progress * 100}%`,
          background: 'var(--color-reading-progress)'
        }}
      />
    </div>
  )
}
