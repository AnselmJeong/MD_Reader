import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { getSettings } from './settings-service'

export type TtsMode = 'document' | 'selection'
export type TtsState = 'idle' | 'initializing' | 'downloading-model' | 'ready' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

export interface TtsUtterance {
  id: string
  text: string
}

export interface TtsSpeakParams {
  mode: TtsMode
  utterances: TtsUtterance[]
  voice?: string
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
let stderrBuffer = ''
let stderrTail: string[] = []
let lastStatus: TtsStatus = { state: 'idle', mode: null }

const DEFAULT_TTS_BACKBONE = 'neuphonic/neutts-air-q8-gguf'
const DEFAULT_TTS_CODEC = 'neuphonic/neucodec-onnx-decoder'
const MAX_STDERR_LINES = 80

function getProjectRoot(): string {
  const cwdScript = path.join(process.cwd(), 'tts', 'reader_tts_server.py')
  if (fs.existsSync(cwdScript)) return process.cwd()

  const resourceScript = path.join(process.resourcesPath, 'tts', 'reader_tts_server.py')
  if (fs.existsSync(resourceScript)) return process.resourcesPath

  const appPathScript = path.join(app.getAppPath(), 'tts', 'reader_tts_server.py')
  if (fs.existsSync(appPathScript)) return app.getAppPath()

  return process.cwd()
}

function getTtsDir(root: string): string {
  return path.join(root, 'tts')
}

function getPythonLaunch(root: string): { command: string; args: string[]; cwd: string } {
  const ttsDir = getTtsDir(root)

  if (process.env.MD_READER_TTS_PYTHON) {
    return {
      command: process.env.MD_READER_TTS_PYTHON,
      args: [getScriptPath(root)],
      cwd: root
    }
  }

  const uvCandidates = [
    process.env.MD_READER_TTS_UV,
    path.join(process.env.HOME || '', '.cargo', 'bin', 'uv'),
    path.join(process.env.HOME || '', '.local', 'bin', 'uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
    'uv'
  ].filter(Boolean) as string[]

  for (const uv of uvCandidates) {
    if (uv === 'uv' || fs.existsSync(uv)) {
      return {
        command: uv,
        args: ['run', 'python', 'reader_tts_server.py'],
        cwd: ttsDir
      }
    }
  }

  const venvPython = path.join(ttsDir, '.venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) {
    return {
      command: venvPython,
      args: [getScriptPath(root)],
      cwd: root
    }
  }

  throw new Error('uv was not found. Install uv or set MD_READER_TTS_UV to the uv executable path.')
}

function getScriptPath(root: string): string {
  return path.join(root, 'tts', 'reader_tts_server.py')
}

function getUvEnvironmentPath(root: string): string {
  if (process.env.UV_PROJECT_ENVIRONMENT) return process.env.UV_PROJECT_ENVIRONMENT
  if (app.isPackaged) return path.join(app.getPath('userData'), 'tts', '.venv')
  return path.join(root, 'tts', '.venv')
}

function getHuggingFaceHome(): string {
  return process.env.HF_HOME || path.join(app.getPath('userData'), 'huggingface')
}

function getReferenceCacheDir(root: string): string {
  if (process.env.MD_READER_TTS_REF_CACHE_DIR) return process.env.MD_READER_TTS_REF_CACHE_DIR
  if (app.isPackaged) return path.join(app.getPath('userData'), 'tts', 'reference-codes')
  return path.join(root, 'tts', '.cache', 'reference-codes')
}

function getConfiguredVoice(): string | undefined {
  const voice = getSettings('ttsVoice')
  return typeof voice === 'string' && voice ? voice : undefined
}

function emitEvent(event: SidecarEvent): void {
  if (event.type === 'status') {
    lastStatus = {
      ...lastStatus,
      ...(event as unknown as TtsStatus),
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

function rememberStderrLine(line: string): void {
  stderrTail.push(line)
  if (stderrTail.length > MAX_STDERR_LINES) {
    stderrTail = stderrTail.slice(-MAX_STDERR_LINES)
  }
  console.warn(`[TTS sidecar] ${line}`)
}

function parseStderr(chunk: Buffer): void {
  stderrBuffer += chunk.toString('utf8')
  let newline = stderrBuffer.indexOf('\n')
  while (newline >= 0) {
    const line = stderrBuffer.slice(0, newline).trim()
    stderrBuffer = stderrBuffer.slice(newline + 1)
    if (line) rememberStderrLine(line)
    newline = stderrBuffer.indexOf('\n')
  }
}

function flushStderrBuffer(): void {
  const line = stderrBuffer.trim()
  if (line) rememberStderrLine(line)
  stderrBuffer = ''
}

function ensureProcess(): ChildProcessWithoutNullStreams {
  if (processRef && !processRef.killed) return processRef

  const root = getProjectRoot()
  const scriptPath = getScriptPath(root)
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`TTS sidecar script not found: ${scriptPath}`)
  }

  const launch = getPythonLaunch(root)

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      UV_PROJECT_ENVIRONMENT: getUvEnvironmentPath(root),
      HF_HOME: getHuggingFaceHome(),
      MD_READER_TTS_BACKBONE: process.env.MD_READER_TTS_BACKBONE || DEFAULT_TTS_BACKBONE,
      MD_READER_TTS_CODEC: process.env.MD_READER_TTS_CODEC || DEFAULT_TTS_CODEC,
      MD_READER_TTS_DEVICE: process.env.MD_READER_TTS_DEVICE || 'cpu',
      MD_READER_TTS_DEFAULT_VOICE: process.env.MD_READER_TTS_DEFAULT_VOICE || getConfiguredVoice() || '',
      MD_READER_TTS_REF_CACHE_DIR: getReferenceCacheDir(root),
      MD_READER_TTS_VOICES_DIR: process.env.MD_READER_TTS_VOICES_DIR || path.join(root, 'tts', 'voices')
    }
  })

  processRef = child
  buffer = ''
  stderrBuffer = ''
  stderrTail = []
  child.stdout.on('data', parseStdout)
  child.stderr.on('data', parseStderr)
  child.on('exit', (code, signal) => {
    flushStderrBuffer()
    processRef = null
    if (code !== 0 && signal !== 'SIGTERM') {
      const stderr = stderrTail.length ? `\n\nRecent stderr:\n${stderrTail.join('\n')}` : ''
      emitEvent({ type: 'error', message: `TTS sidecar exited with code ${code ?? 'unknown'}.${stderr}` })
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
