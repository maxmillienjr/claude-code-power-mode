// Stands in for the engine's 'claude-code' module when the mod runs under Node
// for the demo capture: state lives on the fake $ the harness hands in.
export const atom = (ref, initial) => ({ ref, initial })

export const read = async ($, a) => {
  const v = $.state.peek(a.ref)

  return v === undefined ? a.initial : v
}

export const update = async ($, a, fn) => {
  $.state.put(a.ref, fn(await read($, a)))
}
