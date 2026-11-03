# radical.tools.sdlc.demo.2.standards

The company's standards: what every system follows, how each is measured, and the pipeline they
share. README.md says how the three repositories fit together.

- `.radical/model/` holds the decisions (ADRs) and their fitness functions. Read and change it only
  through the MCP server `radical` (`.mcp.json`). It says nothing of how systems are delivered.
- A system takes a standard on itself in its own model, with `constrains` from the ADR to its
  elements, and measures it with the sensors in `sensors/`, which run in its repository. A sensor
  here works for any repository: nothing in it names a system.
- `pipeline/` and `.github/workflows/` (those with `workflow_call`) are the pipeline. Systems call
  them from the small files in `pipeline/callers/`, at a version.
- A release is a tag `vX.Y.Z`. It opens a pull request in each system with the new version, and
  their Gate says whether they hold against it. A change that would turn a system's Gate red is
  a major version, and the note in its release says what to do.
- Before pushing: `npm test` and `npx radical check .radical/model`.
