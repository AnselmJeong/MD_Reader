import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldApplyRedUnderlineShortcut } from '../src/renderer/src/components/DocumentReader/utils/annotationShortcut.ts'

function keyboardEvent(overrides = {}) {
  return {
    code: 'KeyU',
    key: 'u',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides
  }
}

test('accepts the physical U key in English and Korean keyboard layouts', () => {
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ key: 'u' })), true)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ key: 'U' })), true)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ key: 'ㅕ' })), true)
})

test('rejects modifiers, repeat events, IME composition, and other keys', () => {
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ metaKey: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ ctrlKey: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ altKey: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ shiftKey: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ repeat: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ isComposing: true })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ code: 'KeyH' })), false)
})

test('does not fire while typing or after another handler consumed the event', () => {
  const editableTarget = { closest: () => ({}) }
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ target: editableTarget })), false)
  assert.equal(shouldApplyRedUnderlineShortcut(keyboardEvent({ defaultPrevented: true })), false)
})
