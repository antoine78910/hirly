<!-- contractspec:init:usage:start -->
<!-- This section is managed by `contractspec init` and `contractspec onboard`. Content outside these markers is user-owned and preserved. -->
# ContractSpec Repo Onboarding

Primary track: **Contracts**

Author and validate spec-first contracts before implementation.

## Start Here

1. `contractspec onboard`
2. `contractspec can-help "<what you want to build>"`
3. `contractspec create --type operation`
4. `contractspec generate`
5. `contractspec validate`
6. `contractspec ci`
7. `contractspec doctor`

## Track Guide

### Contracts

Use ContractSpec contracts as the durable source of truth for operations, events, presentations, and validation.

Why it is recommended here: Multiple similarly strong adoption candidates were found.

Primary docs: /docs/getting-started/start-here
More docs: /docs/guides/spec-validation-and-typing, /docs/guides/generate-docs-clients-schemas
Starter example: Minimal (`minimal`)
Example package: `@lssm-tech/example.minimal`

Commands:
- `contractspec create --type operation`
- `contractspec generate`
- `contractspec validate`
- `contractspec ci`

Packages: `@lssm-tech/lib.contracts-spec`, `@lssm-tech/lib.schema`

### Learning Journey

Use the learning-journey module and example family for structured onboarding and progression flows.

Why it is recommended here: Selected contractspec candidate @lssm-tech/module.learning-journey.

Primary docs: /docs/guides/first-module-bundle
More docs: /docs/getting-started/start-here
Starter example: Learning Journey UI Onboarding (`learning-journey-ui-onboarding`)
Example package: `@lssm-tech/example.learning-journey-ui-onboarding`
Advanced example: Learning Journey Registry (`learning-journey-registry`)

Commands:
- `contractspec examples list --query learning-journey`
- `contractspec validate`
- `contractspec doctor`

Packages: `@lssm-tech/module.learning-journey`, `@lssm-tech/lib.surface-runtime`

### UI Design

Use ThemeSpec, the design system, and composed UI surfaces instead of ad-hoc theme files or raw primitives.

Why it is recommended here: Selected contractspec candidate @lssm-tech/lib.design-system.

Primary docs: /docs/tech/contracts/themes
More docs: /docs/guides/first-module-bundle, /docs/getting-started/installation
Starter example: Data Grid Showcase (`data-grid-showcase`)
Example package: `@lssm-tech/example.data-grid-showcase`

Commands:
- `contractspec create --type theme`
- `contractspec generate`
- `contractspec validate`

Packages: `@lssm-tech/lib.design-system`, `@lssm-tech/lib.surface-runtime`

### Knowledge

Use knowledge spaces, bindings, and governed retrieval instead of prompt-only context injection.

Why it is recommended here: Selected contractspec candidate @lssm-tech/lib.knowledge.

Primary docs: /docs/knowledge
More docs: /docs/knowledge/spaces, /docs/knowledge/examples
Starter example: Knowledge Canon (`knowledge-canon`)
Example package: `@lssm-tech/example.knowledge-canon`
Advanced example: Policy-Safe Knowledge Assistant (`policy-safe-knowledge-assistant`)

Commands:
- `contractspec create --type knowledge`
- `contractspec validate`
- `contractspec connect adoption resolve --family sharedLibs --stdin`

Packages: `@lssm-tech/lib.knowledge`, `@lssm-tech/lib.ai-agent`

### AI Agents

Use the ContractSpec agent runtime and agent specs instead of ad-hoc prompt wrappers.

Why it is recommended here: Selected contractspec candidate @lssm-tech/lib.ai-agent.

Primary docs: /docs/libraries/ai-agent
More docs: /docs/advanced/mcp, /docs/getting-started/cli
Starter example: Agent Console (`agent-console`)
Example package: `@lssm-tech/example.agent-console`

Commands:
- `contractspec create --type agent`
- `contractspec agent export --spec <path> --format opencode`
- `contractspec validate`

Packages: `@lssm-tech/lib.ai-agent`, `@lssm-tech/lib.contracts-spec`

## Builder Paths

- `contractspec init --preset builder-managed`
- `contractspec init --preset builder-local`
- `contractspec init --preset builder-hybrid`
<!-- contractspec:init:usage:end -->
