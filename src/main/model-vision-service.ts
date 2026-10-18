import { codexClient } from './codex/client'
import { parseSubscriptionModel } from '../shared/subscription'
import type { ModelVisionInfo } from '../shared/chat-images'

export async function getModelVisionInfo(value: string): Promise<ModelVisionInfo> {
  try {
    const { provider, model } = parseSubscriptionModel(value)
    if (provider === 'claude') return { model: value, vision: 'supported' }
    const models = await codexClient.models()
    const selected = model ? models.find(m => m.id === model) : models.find(m => m.isDefault) ?? models[0]
    return { model: value, vision: selected?.inputModalities?.includes('image') ? 'supported' : selected?.inputModalities?.length ? 'unsupported' : 'unknown' }
  } catch { return { model: value, vision: 'unknown' } }
}
