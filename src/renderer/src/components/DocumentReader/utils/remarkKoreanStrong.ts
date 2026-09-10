import { attention } from 'micromark-core-commonmark'
import type { Processor } from 'unified'

/**
 * CommonMark treats `)**한글` as an opener, which can leave literal markers
 * or pair them with a later term. Allow this Korean suffix boundary to close
 * a two-asterisk strong delimiter; let micromark handle all other syntax.
 */
const tokenizeKoreanStrong: typeof attention.tokenize = function (effects, ok, nok) {
  const previous = this.previous
  let sequence: ReturnType<typeof effects.exit> | undefined
  return attention.tokenize.call(this, {
    ...effects,
    exit(type) {
      const token = effects.exit(type)
      if (type === 'attentionSequence') sequence = token
      return token
    }
  }, (code) => {
    if (
      sequence
      && sequence.end.offset - sequence.start.offset === 2
      && this.sliceSerialize(sequence) === '**'
      && previous !== null && previous > 0 && /\p{P}/u.test(String.fromCodePoint(previous))
      && code !== null && code > 0 && /\p{Script=Hangul}/u.test(String.fromCodePoint(code))
    ) {
      sequence._close = true
      sequence._open = false
    }
    return ok(code)
  }, nok)
}

export function remarkKoreanStrong(this: Processor) {
  const extensions = this.data('micromarkExtensions') || []
  this.data('micromarkExtensions', [
    ...extensions,
    { text: { 42: { ...attention, tokenize: tokenizeKoreanStrong } } }
  ])
}
