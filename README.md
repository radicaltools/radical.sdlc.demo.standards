# radical.sdlc.demo.standards

The company's standards in **radical.sdlc.demo**: four decisions every system follows, how each is measured,
and the parts of the delivery pipeline every repository runs: the Gate, the agents and the tools around them.

The demo builds one system, a shop and a warehouse, in three repositories:

| Repository | What it holds | What it takes from here |
|---|---|---|
| [architecture](https://github.com/radicaltools/radical.sdlc.demo.architecture) | The one model of the whole system, and the pipeline that takes a change from its ticket to its acceptance | the standards' model, read-only, and the agents |
| [warehouse](https://github.com/radicaltools/radical.sdlc.demo.warehouse) | Code: stock, reservations, dispatch | the Gate, the sensors and the agents |
| [shop](https://github.com/radicaltools/radical.sdlc.demo.shop) | Code: prices, orders, notifications | the same |
| **standards** (this one) | The decisions, their fitness functions and sensors, the Gate, the agents | — |

How a change goes through the demo, from a ticket to merged code, is in
[the architecture repository](https://github.com/radicaltools/radical.sdlc.demo.architecture#how-a-change-gets-through).
This page says what the standards do in it.

## The decisions

| Decision (ADR) | Fitness function | Sensor | Runs |
|---|---|---|---|
| Services talk over HTTP | Services stay on their own | [`boundaries`](sensors/boundaries.mjs): every import in a service stays inside it, or names a workspace of shared types | in every pull request |
| APIs described in OpenAPI | API matches its description | [`openapi`](sensors/openapi.mjs): a service's routes and its `openapi.yaml` name the same operations, both ways | in every pull request |
| Retried writes change nothing | Repeated write changes nothing | [`idempotency`](sensors/idempotency.mjs): each named write is sent twice, after each other and at once; the answers and the state are those of one write | in every pull request |
| Rules hold under any sequence | Rules hold in random sequences | [`fuzz`](sensors/fuzz.mjs): the repository's fuzz files, on their seeds | at night, which the demo does not run |

They are in this repository's model, `.radical/model`. Each sensor measures one element at a time, in the
repository that builds it, and judges nothing: the condition in the fitness function's model judges the value.

## How the demo uses the standards

### 1. In the model, as a dependency

The architecture's model names this one in `.radical/model/deps.json`, at a tag (`v2.3.0` today). That is a
federation of two models: the standards' decisions and fitness functions show in the system's model beside its
own, read-only, in Studio, in the MCP server the agents use, and in `radical check`. Their elements carry the
origin `standards@<commit>`, so nobody edits them there.

The standards do not know who follows them. The system takes a decision on in its own model, with a relation
`constrains` from the ADR to its services: *Services talk over HTTP* constrains all five services, for example.
From then on that decision is measured for those services.

The Warehouse and the Shop have no model of their own, and no `deps.json`. They are judged on their part of the
architecture's model, which brings the standards with it.

### 2. In every Gate of the Warehouse and the Shop

Each of them calls [`gate.yml`](.github/workflows/gate.yml) from its `ci.yml`, at the same tag:

```yaml
uses: radicaltools/radical.sdlc.demo.standards/.github/workflows/gate.yml@v2.3.0
```

The Gate is the one required check of a pull request, and no AI runs in it. On the repository's checkout it:

1. Fetches the model at the commit the code has reached, and this repository at the tag the model pins, into
   `.standards/` (the repository's `tools/standards.mjs`). It fails when the workflows name another tag than the model.
2. Installs Node and the packages ([`setup`](.github/actions/setup/action.yml)), then runs the type check and the tests,
   writing their reports.
3. Runs the sensors of every fitness function triggered on a pull request (`radical sense run`). A fitness function
   runs once for each element its ADR constrains and the repository builds; the repository's `.radical/sensors/sensors.json`
   says which command is which sensor: `node .standards/sensors/boundaries.mjs` for the standards' ones, its own for
   the rest.
4. Checks that every commit of an agent stayed in that agent's scope ([`agent-scope.mjs`](pipeline/tools/agent-scope.mjs)).
5. Runs `radical check` on the repository's part of the model: every requirement has a scenario with a test that
   passed, and every fitness function's condition holds on what the sensors measured. One that does not, a
   standard's among them, turns the pull request red.

When a Gate is red, a person can give the pull request the label `agent:fix`: the Warehouse and the Shop call
[`model-and-code.yml`](.github/workflows/model-and-code.yml) at the same tag, and its coding agent fixes the code on
that branch, without weakening a test.

### 3. In the agents

The agents are skills of Claude Code, in [`pipeline/skills`](pipeline/skills), copied into each repository's
`.claude/skills/` by `tools/standards.mjs`. [`run-agent.mjs`](pipeline/tools/run-agent.mjs) runs one headless
(`claude -p`), with Claude Haiku unless `AGENT_MODEL` says otherwise, and with the allow-list of
[`agents.mjs`](pipeline/tools/agents.mjs):

| Agent | May change | May not |
|---|---|---|
| model agent | the model, through the MCP server | code, tests, the model's settings |
| coding agent | `services/`, `packages/`, `tests/`, the test bindings in `.radical/radical.json`, findings | the model, the sensors, the workflows, npm packages |

The agents hold no credentials. The workflows commit for them under their names ([`commit-as.sh`](pipeline/tools/commit-as.sh)),
and the Gate's scope check reads those names. Only a ticket of someone with write access starts an agent, and the
brief holds only what such people said on it ([`questions.mjs`](pipeline/tools/questions.mjs)).

The architecture repository runs the model agent on the whole system's model, and the coding agents on each
repository's branch of a change. It takes the skills and tools from here and adds what the demo needs on top: the
model agent's skill is told that the model is the whole system, a review agent reads its change against the ticket,
and each agent says what became of its run in a JSON shape. That is its own code, in its `pipeline/`.

### 4. A new version

1. A change merges here, and gets a tag.
2. The system moves to it in one change: the tag in the architecture's `deps.json`, and in the Warehouse's and the
   Shop's `ci.yml` and `model-and-code.yml`. Each Gate fails while the two differ.
3. Each Gate then runs against the new version: new decisions, sensors, Gate and agents. Green means the system
   follows them. Red shows which service does not, before anything merges.

Nothing runs here when a tag is made, and nothing here lists who uses it.

## What is here

```
.radical/model/          the four decisions and their fitness functions
sensors/                 what measures them, run in the repository that builds the element
pipeline/skills/         the agents: model, coding, testing, explore
pipeline/tools/          what the workflows run: run-agent, allow-lists, scope check, briefs, commits
pipeline/callers/        the few lines a repository calls a workflow with
.github/workflows/       the pipeline, as reusable workflows, and this repository's own Gate (ci.yml)
```

This repository's own Gate runs the tests of the pipeline and of the sensors, and checks its model.

## Here, and not used by the demo yet

These are ready for a system to call, and the demo does not: the testing agent ([`testing-agent.yml`](.github/workflows/testing-agent.yml)),
the nightly measures, fuzzing and exploratory agents ([`nightly.yml`](.github/workflows/nightly.yml)), deployment
([`deploy.yml`](.github/workflows/deploy.yml)), and, for systems that keep a model in each repository, pin updates
([`update-pins.yml`](.github/workflows/update-pins.yml)), handing work to another repository and waiting for it
([`waiting-tickets.yml`](.github/workflows/waiting-tickets.yml)), and a loop per repository
([`reconcile.yml`](.github/workflows/reconcile.yml)). The fitness function *Rules hold in random sequences* runs only at night,
so in the demo it is not measured.

## Use it in your own account

Fork this repository and the demo's three, replace `radicaltools` in the architecture's `deps.json` and
`.radical/system.json` and in every repository's workflows and `.radical/radical.json`, and tag this one first.
[`pipeline/setup-github.sh`](pipeline/setup-github.sh) creates a repository on GitHub with its labels, its secrets
(`ANTHROPIC_API_KEY` from the [Claude Console](https://platform.claude.com), and `AGENT_TOKEN`, a fine-grained token on
the demo's repositories with Contents, Pull requests, Issues and Actions: read and write) and the rule that its main
branch takes changes only through a pull request with a green Gate.
