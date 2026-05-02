import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'

export type TtsMode = 'document' | 'selection'
export type TtsState = 'idle' | 'initializing' | 'downloading-model' | 'ready' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

export interface TtsUtterance {
  id: string
  text: string
}

export interface TtsSpeakParams {
  mode: TtsMode
  utterances: TtsUtterance[]
}

export interface TtsStatus {
  state: TtsState
  mode?: TtsMode | null
  message?: string
  voices?: string[]
}

type SidecarEvent = Record<string, unknown> & { type?: string }

const emitter = new EventEmitter()

let processRef: ChildProcessWithoutNullStreams | null = null
let buffer = ''
let lastStatus: TtsStatus = { state: 'idle', mode: null }

function getProjectRoot(): string {
  const cwdScript = path.join(process.cwd(), 'tts', 'reader_tts_server.py')
  if (fs.existsSync(cwdScript)) return process.cwd()

  const appPathScript = path.join(app.getAppPath(), 'tts', 'reader_tts_server.py')
  if (fs.existsSync(appPathScript)) return app.getAppPath()

  return process.cwd()
}

function getPythonExecutable(root: string): string {
  if (process.env.MD_READER_TTS_PYTHON) return process.env.MD_READER_TTS_PYTHON

  const venvPython = path.join(root, 'tts', '.venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) return venvPython

  return 'python3'
}

function getScriptPath(root: string): string {
  return path.join(root, 'tts', 'reader_tts_server.py')
}

function emitEvent(event: SidecarEvent): void {
  if (event.type === 'status') {
    lastStatus = {
      ...lastStatus,
      ...(event as TtsStatus),
      state: (event.state as TtsState) || lastStatus.state
    }
  }
  if (event.type === 'error') {
    lastStatus = { ...lastStatus, state: 'error', message: String(event.message || 'Unknown TTS error') }
  }
  emitter.emit('event', event)
}

function parseStdout(chunk: Buffer): void {
  buffer += chunk.toString('utf8')
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try {
        emitEvent(JSON.parse(line))
      } catch {
        emitEvent({ type: 'error', message: line })
      }
    }
    newline = buffer.indexOf('\n')
  }
}

function ensureProcess(): ChildProcessWithoutNullStreams {
  if (processRef && !processRef.killed) return processRef

  const root = getProjectRoot()
  const scriptPath = getScriptPath(root)
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`TTS sidecar script not found: ${scriptPath}`)
  }

  const child = spawn(getPythonExecutable(root), [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      MD_READER_TTS_VOICES_DIR: process.env.MD_READER_TTS_VOICES_DIR || path.join(root, 'tts', 'voices')
    }
  })

  processRef = child
  buffer = ''
  child.stdout.on('data', parseStdout)
  child.stderr.on('data', (chunk) => {
    const message = chunk.toString('utf8').trim()
    if (message) emitEvent({ type: 'error', message })
  })
  child.on('exit', (code, signal) => {
    processRef = null
    if (code !== 0 && signal !== 'SIGTERM') {
      emitEvent({ type: 'error', message: `TTS sidecar exited with code ${code ?? 'unknown'}.` })
    }
  })

  return child
}

function send(command: Record<string, unknown>): void {
  const child = ensureProcess()
  child.stdin.write(`${JSON.stringify(command)}\n`)
}

export function onTtsEvent(listener: (event: SidecarEvent) => void): () => void {
  emitter.on('event', listener)
  return () => emitter.off('event', listener)
}

export async function speakTts(params: TtsSpeakParams): Promise<{ success: boolean; error?: string }> {
  try {
    send({ type: 'speak', ...params })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start TTS' }
  }
}

export async function controlTts(command: 'pause' | 'resume' | 'stop' | 'restart'): Promise<{ success: boolean; error?: string }> {
  try {
    send({ type: command })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : `Failed to ${command} TTS` }
  }
}

export async function getTtsStatus(): Promise<TtsStatus> {
  try {
    send({ type: 'status' })
  } catch {
    return lastStatus
  }
  return lastStatus
}

export function shutdownTts(): void {
  if (!processRef) return
  try {
    processRef.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
  } catch {
    // Ignore shutdown races.
  }
  processRef.kill()
  processRef = null
}
