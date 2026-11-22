import fs from 'node:fs/promises'

/**
 * Reads a whole file like fs.readFile, but survives a failing close().
 *
 * On macOS SMB shares (e.g. a Synology NAS), close() can fail with EBADF when
 * another process (OrbStack/Docker, Spotlight, …) holds the same file open,
 * even though every byte was already read. fs.readFile treats that as a read
 * failure, so documents on such shares could not be opened at all.
 */
export async function readFileTolerant(filePath: string): Promise<Buffer>
export async function readFileTolerant(filePath: string, encoding: BufferEncoding): Promise<string>
export async function readFileTolerant(filePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
  const handle = await fs.open(filePath, 'r')
  let buffer: Buffer
  try {
    const { size } = await handle.stat()
    buffer = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset < size) buffer = buffer.subarray(0, offset)
    // The file may have grown since stat(); pick up any remaining bytes.
    const tail: Buffer[] = []
    for (;;) {
      const chunk = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset)
      if (!bytesRead) break
      tail.push(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
    if (tail.length) buffer = Buffer.concat([buffer, ...tail])
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
  try {
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error
    console.warn(`[File] Ignored EBADF on close after a complete read: ${filePath}`)
  }
  return encoding ? buffer.toString(encoding) : buffer
}
