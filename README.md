# radical.tools.sdlc.demo.2.standards

Part of a demo: **one company, three repositories, one architecture model joined by federation,
and a delivery pipeline on GitHub where agents propose and deterministic checks decide.**
[radical.tools.sdlc.demo.1](https://github.com/radicaltools/radical.tools.sdlc.demo.1) shows the
pipeline on one monorepo. This one shows what changes when there are several teams.

| Repository | What it holds | Depends on |
|---|---|---|
| **standards** (this one) | The decisions every system follows, how each is measured, the pipeline | nothing |
| [warehouse](https://github.com/radicaltools/radical.tools.sdlc.demo.2.warehouse) | The Warehouse: stock, reservations, dispatch | standards |
| [shop](https://github.com/radicaltools/radical.tools.sdlc.demo.2.shop) | The Shop: prices, orders, notifications | standards, warehouse |

Each repository keeps the model of what it builds. Its `.radical/model/deps.json` names the models
it depends on, each at a version, and every tool shows them beside its own, read-only: Studio, the
MCP server the agents use, and `radical check` in the Gate. Open the Shop's `.radical` in
[Radical Studio](https://radical.tools) and you see all three; its folder **Landscape** draws them together.

![Three lanes, one per repository. The standards hold the decisions and fitness functions, the sensors and the pipeline. The Warehouse and the Shop read each of them at a pinned version: the model, the sensors they run, the pipeline their workflows call. The Shop also reads the Warehouse's model, its OpenAPI descriptions and its images, at a pinned version.](docs/repositories.svg)

Each lane is a repository. An arrow is what one reads from another, always at the version it pins.
Violet holds the agents.

## What is here

```
.radical/model/          the decisions and their fitness functions
sensors/                 what measures them, run in the repository of the system measured
pipeline/tools/          what the workflows run: allow-lists, scope check, rounds, findings
pipeline/skills/         the agents
pipeline/callers/        the few lines a repository calls the pipeline with
.github/workflows/       the pipeline, as reusable workflows, and this repository's own gate
```

| Decision | Fitness function | Sensor |
|---|---|---|
| Services talk over HTTP | Services stay on their own | `boundaries` |
| APIs described in OpenAPI | API matches its description | `openapi` |
| Retried writes change nothing | Repeated write changes nothing | `idempotency` |
| Rules hold under any sequence | Rules hold in random sequences | `fuzz` |

## How a standard reaches a system

The standards' model says what holds. It does not know who follows it. A system takes it on in **its
own** model: a relation `constrains` from the ADR to its services. From then on `radical sense run`
in that system's Gate measures the fitness function once per service, with the sensor at the version
the system pins, and `radical check` fails that system's pull request if it does not hold.

So the same fitness function has a different answer per system, and the answer is in the system's
own pull request, in front of the team that can fix it.

## How a new version travels

![A person tags the standards, and nothing runs. Every day the Warehouse and the Shop each look at the tags of what they depend on. A new one becomes a pull request in that repository, with what changed in the model, and its Gate checks the repository against the new version. Each team merges when it can. A tag of the Warehouse reaches the Shop the same way.](docs/new-version.svg)

**This repository does not know who uses it.** There is no list of them anywhere, and a tag runs nothing here. A repository
that depends on another declares it in its own `deps.json`, and looks for new versions itself.

1. A change merges here and gets a tag, `v1.1.0`.
2. Every day, or by hand, [`update-pins.yml`](.github/workflows/update-pins.yml) runs in the Warehouse and in the Shop, each
   on its own. It reads the tags of each repository in `deps.json`.
3. A newer version becomes a pull request there: the pin in `deps.json` moves, and so does the version in its workflows,
   which `tools/standards.mjs --check` in its Gate keeps equal. A newer tag moves the open pull request along.
4. The text of the pull request says what changed in the model of the dependency, from `radical diff` between the two tags.
   A decision whose text changed leaves the Gate green, because the Gate reads what is measured, so a person reads this.
5. Each repository's Gate runs against the new version: the new decisions, the new sensors, the new pipeline. Green means it
   holds. Red shows exactly which service does not, before anything merged.
6. A person merges. The pins can differ for a while, so a team moves when it can. When the Shop reads a Warehouse pinned at
   another version of the standards, its own pin wins, and the check says so.

The Warehouse's tags reach the Shop the same way, with its OpenAPI descriptions and images. The price is the wait, a day at
most, and starting the workflow by hand ends it. GitHub stops the schedule of a public repository with no activity for 60 days.

## The pipeline

The workflows here have `workflow_call`, and run in the repository that calls them, on its checkout, with
`.standards/` at the version it pins. It is demo.1's pipeline with one change: it exists once.

A ticket goes in at the top and a deployed commit comes out, and a person acts twice: by giving
the label and by merging. This is what happens in the Warehouse and in the Shop. Each box names the
part of Radical it uses.

### During the day

![The whole flow by role: a person opens a ticket, the model agent changes the model and asks if the ticket is unclear, the coding agent builds from get_changes, the Gate decides, the testing agent proposes tests, the pull request is marked ready, a person merges, and it deploys.](docs/sdlc-day.svg)

### Every night

![The night by role: the sensors and the fuzz file measure, an agent per area explores, each finding runs again without the agent, the findings are proposed, a person merges them and starts the agents on one.](docs/sdlc-night.svg)

Yellow is a person, violet an agent on Claude Code, green has no AI and gives the same answer
every time. The box that stands out is the Gate, the one required check.

At night each part a repository builds gets an agent of its own: the areas come from the model, one for each element
`.radical/radical.json` maps that has requirements, and name those requirements. A new service gets its agent with nothing to
configure, and the brief names what changed in the model since the night before.

### The workflows

| Workflow | Starts on | AI | What it does |
|---|---|---|---|
| [`gate.yml`](.github/workflows/gate.yml) | every pull request | no | **Gate**, the one required check. Also comments what changed in the model. |
| [`model-and-code.yml`](.github/workflows/model-and-code.yml) | label `agent:implement` on an issue, `agent:fix` on a pull request, or by hand on a finding | yes | The model agent writes the model, the coding agent implements it. Also fixes a red pull request. |
| [`testing-agent.yml`](.github/workflows/testing-agent.yml) | a pull request changing the model or a service | yes | Proposes the missing tests in a pull request into that branch. |
| [`nightly.yml`](.github/workflows/nightly.yml) | every night | sensors and fuzz no, explore agents yes | Measures, fuzzes on a random seed, explores, and proposes findings on one rolling branch. |
| [`prepare-for-review.yml`](.github/workflows/prepare-for-review.yml) | the gate or the testing agent ending | no | With `AGENT_AUTOMATION`: merges a green proposal into its branch, marks a finished pull request ready for review. |
| [`deploy.yml`](.github/workflows/deploy.yml) | a commit on main, a version tag | no | Starts the stack on the runner, smoke-tests it, then publishes the images. |
| [`update-pins.yml`](.github/workflows/update-pins.yml) | every day, or by hand | no | Finds new versions of what the repository depends on, and opens a pull request for each. |

How the agents are kept honest is the same as in
[demo.1](https://github.com/radicaltools/radical.tools.sdlc.demo.1#how-the-agents-are-kept-honest): the model
and the code have separate authors, no AI runs in the Gate, the agents hold no credentials and work from
an allow-list, and only someone with write access starts them.

## Limits of this demo

- **A system is one repository here.** Radical cannot yet place a container of one repository inside a
  system of another's model, so a system split over several repositories is left out.
- A company with a landscape of its own would keep it in a repository of its own. Here the Shop draws it,
  because it is the one that depends on the other two.

## Set it up in your own account

Fork all three, in this order, and rename `radicaltools` in `deps.json`, the workflows and `docker-compose.yml`. Then, in each repository:

```bash
npm ci
pipeline/setup-github.sh <owner>/<name> Gate       # here
.standards/pipeline/setup-github.sh <owner>/<name> "checks / Gate"   # in a system, after npm run standards
```

The script asks for `ANTHROPIC_API_KEY`, from the [Claude Console](https://platform.claude.com), and `AGENT_TOKEN`, a fine-grained
token on that repository alone with Contents, Pull requests, Issues and Workflows: read and write. No repository needs
to write to another. Tag
the standards first, and the Warehouse before the Shop, because the Shop's deploy runs the Warehouse's images.

Those images are private, as a company's would be. After the Warehouse's first deploy, open the settings of its
packages `stock` and `dispatch` on GitHub, and under **Manage Actions access** add the Shop's repository with the role
Read. The token of the Shop's workflow can then pull them, and nobody else can.
