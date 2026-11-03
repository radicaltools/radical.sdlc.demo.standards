// What the sensors share: the --context radical sense run gives them (the
// fitness function, its ADR, and the element with its paths from the repository's
// .radical/radical.json). A sensor runs in the repository it measures.

/** The --context radical sense run gives a sensor. */
export function sensorContext(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--context')
  if (i < 0) fail('no --context: run this sensor with radical sense run', 2)
  return JSON.parse(argv[i + 1])
}

/** The context's element; exits 2 when .radical/radical.json gives it no paths. */
export function measuredElement(context) {
  const element = context.element
  if (!element?.paths?.length) fail(`no paths for ${element?.label ?? 'the element'} in .radical/radical.json`, 2)
  return element
}

export function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}
