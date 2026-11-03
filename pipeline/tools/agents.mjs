// What each agent may do, in one place. `tools` is the allow-list claude -p
// runs it with (an Edit rule covers every file-editing tool; anything else is
// denied, as nobody is there to ask). A path rule starts with a slash, from the
// project's root: without it the rule follows the working directory, and stops
// matching after an agent runs `cd run-1 && node x.mjs`. `scope` is what its commits may change,
// which the gate checks afterwards (tools/agent-scope.mjs). The workflows
// commit as `author`; the agents hold no git credentials.
//
// The model agent writes the model and no code; the coding agent writes code from
// what changed in the model (get_changes) and cannot change the model.

const READ = ['Read', 'Glob', 'Grep']
const READ_MODEL = ['get_model_summary', 'search_model', 'get_changes', 'get_issues', 'get_verification', 'get_implementation'].map((t) => `mcp__radical__${t}`)
const INSPECT = ['Bash(git diff*)', 'Bash(git status*)', 'Bash(git log*)']
const RUN = ['Bash(npm run typecheck*)', 'Bash(npm run test*)', 'Bash(npx vitest *)', 'Bash(npx tsc *)', 'Bash(npx tsx *)']

export const AGENTS = {
  'model-agent': {
    author: 'radical-model-agent',
    maxTurns: 50,
    tools: [...READ, 'mcp__radical', ...INSPECT, 'Bash(npx radical check*)', 'Bash(npx radical diff*)'],
    denied: ['mcp__radical__set_verification', 'mcp__radical__set_implementation'],
    scope: { allow: ['.radical/model/**'], deny: ['.radical/model/check.json', '.radical/model/deps.json'] },
  },
  'coding-agent': {
    author: 'radical-coding-agent',
    maxTurns: 80,
    tools: [...READ, ...READ_MODEL, 'mcp__radical__set_verification', 'mcp__radical__set_implementation', ...INSPECT, ...RUN, 'Bash(npx radical *)',
      'Edit(/services/**)', 'Edit(/packages/**)', 'Edit(/tests/**)', 'Edit(/.radical/sensors/**)', 'Edit(/.radical/crucible/findings/**)'],
    scope: { allow: ['services/**', 'packages/**', 'tests/**', '.radical/radical.json', '.radical/sensors/**', '.radical/crucible/findings/**'] },
  },
  'testing-agent': {
    author: 'radical-testing-agent',
    maxTurns: 50,
    tools: [...READ, ...READ_MODEL, ...INSPECT, ...RUN, 'mcp__radical__set_verification', 'Bash(npx radical check*)', 'Bash(npx radical verify*)', 'Bash(npx radical sense*)',
      'Edit(/services/*/test/**)', 'Edit(/tests/**)', 'Edit(/.radical/sensors/**)'],
    scope: { allow: ['services/*/test/**', 'tests/**', '.radical/sensors/**', '.radical/radical.json'] },
  },
  'explore-agent': {
    author: 'radical-explore-agent',
    maxTurns: 50,
    tools: [...READ, ...READ_MODEL, 'Bash(git log*)', 'Bash(node *)', 'Bash(ls *)',
      'Edit(/.radical/crucible/rounds/**)', 'Write(/.radical/crucible/rounds/**)'],
    scope: { allow: ['.radical/crucible/findings/**'] },
  },
}

/** `**` crosses folders, `*` stays inside one. */
function matches(glob, path) {
  const source = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')
  return new RegExp(`^${source}$`).test(path)
}

/** The paths of `paths` that the agent `name` may not change. */
export function outOfScope(name, paths) {
  const { allow, deny = [] } = AGENTS[name].scope
  return paths.filter((p) => deny.some((g) => matches(g, p)) || !allow.some((g) => matches(g, p)))
}

/** The agent whose commits carry the author `author`, if any. */
export function agentOfAuthor(author) {
  return Object.keys(AGENTS).find((name) => AGENTS[name].author === author)
}

/** The environment an agent runs in: without anything that could push or call
 *  another service. The Claude API key stays, when it is set. */
export function agentEnvironment(env) {
  const kept = {}
  for (const [key, value] of Object.entries(env)) {
    if (key === 'ANTHROPIC_API_KEY') { if (value) kept[key] = value; continue }
    if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$/i.test(key)) continue
    kept[key] = value
  }
  return kept
}
