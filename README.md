# Copilot Smart

Copilot Smart is a VS Code extension designed to make local LLMs the
first-class coding assistant while keeping the workflow inside VS Code.

It supports local OpenAI-compatible coding models through:

-   **Ollama**
-   **LM Studio**
-   **llama.cpp**
-   **Generic OpenAI-compatible endpoints**

The extension provides local model discovery, connection monitoring, a
Control Center, local task execution, project-aware Smart Local Tasks,
usage/configuration management, and a status-bar connection indicator.

------------------------------------------------------------------------

## Why Copilot Smart?

Copilot Smart is intended for development workflows where you want to:

-   Use local LLMs for coding tasks.
-   Reduce unnecessary GitHub Copilot usage.
-   Keep project analysis and coding tasks local where possible.
-   Switch between local providers and models easily.
-   Give the local model enough project context to make better coding
    decisions.
-   Run larger coding tasks through a project-aware multi-agent
    workflow.
-   Keep the workflow inside VS Code instead of switching between
    terminals and external AI tools.

> **Recommended approach:** Use local models for repository analysis,
> implementation, refactoring, debugging, documentation, tests, and code
> review. Use cloud/Copilot only when the task genuinely benefits from
> it.

------------------------------------------------------------------------

# 1. Architecture

The normal workflow is:

``` text
                         VS Code
                            │
                    ┌───────┴────────┐
                    │  Copilot Smart │
                    └───────┬────────┘
                            │
                ┌───────────┼────────────┐
                │           │            │
                ▼           ▼            ▼
            Ollama      LM Studio    llama.cpp
                │           │            │
                └───────────┼────────────┘
                            │
                            ▼
                       Local Model
```

For larger coding tasks:

``` text
                    Smart Local Task
                           │
                           ▼
                 Repository Analysis
                           │
                           ▼
                 Project Understanding
                           │
                           ▼
                  Agent Orchestrator
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      Architect       Implementer       Analyst
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                      Test / Review
                           │
                           ▼
                    Fix / Improve
                           │
                           ▼
                       Result
```

------------------------------------------------------------------------

# 2. Installation

Install the VSIX package from VS Code:

1.  Open VS Code.
2.  Press `Ctrl+Shift+P`.
3.  Select:

``` text
Extensions: Install from VSIX...
```

4.  Select the Copilot Smart `.vsix` file.
5.  Reload VS Code.

After installation, the **Copilot Smart** icon should appear in the
Activity Bar.

------------------------------------------------------------------------

# 3. First-Time Setup

The recommended first-time setup is:

``` text
Install Ollama
      ↓
Install a coding model
      ↓
Start Ollama
      ↓
Install Copilot Smart
      ↓
Detect local providers
      ↓
Discover models
      ↓
Select a model
      ↓
Test connection
      ↓
Start coding
```

For Ollama, the default endpoint is:

``` text
http://127.0.0.1:11434
```

Check that Ollama is listening:

### Windows

``` powershell
netstat -ano | findstr :11434
```

Expected:

``` text
TCP    127.0.0.1:11434    0.0.0.0:0    LISTENING
```

Check models:

``` powershell
ollama list
```

Check the API:

``` powershell
curl.exe http://127.0.0.1:11434/api/tags
```

### Linux

``` bash
ss -lntp | grep 11434
```

Check models:

``` bash
ollama list
```

Check the API:

``` bash
curl http://127.0.0.1:11434/api/tags
```

------------------------------------------------------------------------

# 4. Recommended Provider Configuration

For a local Ollama installation:

``` json
{
  "provider": "ollama",
  "host": "127.0.0.1",
  "port": 11434
}
```

The important values are:

  Setting    Recommended value
  ---------- -------------------
  Provider   `ollama`
  Host       `127.0.0.1`
  Port       `11434`

For a local server running on another machine, replace `127.0.0.1` with
the server's reachable IP address and configure the server/firewall
accordingly.

------------------------------------------------------------------------

# 5. Control Center

Open the **Copilot Smart** Activity Bar icon.

The Control Center provides the main workflow for the extension.

Typical actions include:

-   Open Settings
-   Detect Local LLMs
-   Discover Models
-   Test Connection
-   Refresh Status
-   Generate `provider.json`
-   Start Local Task
-   Show Status

The Control Center should be the primary entry point for configuring and
testing Copilot Smart.

------------------------------------------------------------------------

# 6. Model Discovery

After connecting a provider, use:

``` text
Copilot Smart → Discover Models
```

For Ollama, model discovery uses:

``` text
GET /api/tags
```

For OpenAI-compatible providers, model discovery uses:

``` text
GET /v1/models
```

Once models are discovered, select the model you want to use.

For example:

``` text
qwen3:8b
```

or another installed coding-capable model.

The selected model is stored in the Copilot Smart configuration.

------------------------------------------------------------------------

# 7. Verify the Connection

Use:

``` text
Copilot Smart → Test Connection
```

The status-bar icon provides a quick indication of the current state.

The status bar intentionally uses only a compact icon.

Typical states are:

  -----------------------------------------------------------------------
  State                   Icon                    Meaning
  ----------------------- ----------------------- -----------------------
  Ready                   🚀                      Local provider
                                                  connected and model
                                                  selected

  Connecting              🔄                      Connection test is
                                                  running

  Authentication          🔑                      Authentication is
                                                  required

  Select Model            ⏸                       Provider is available
                                                  but no model is
                                                  selected

  Not Connected           ❌                      Local provider is
                                                  unavailable

  Cloud Ready             ☁                       Cloud fallback is
                                                  available in
                                                  local-preferred mode
  -----------------------------------------------------------------------

Hover over the icon to see the detailed status.

Clicking the icon opens the Copilot Smart Settings page.

If Settings is already open, Copilot Smart reuses the existing Settings
tab instead of creating duplicate Settings tabs.

------------------------------------------------------------------------

# 8. Configuration

Copilot Smart maintains local configuration under:

``` text
~/.copilot-smart/
```

The main configuration file is:

``` text
~/.copilot-smart/config.json
```

A typical configuration looks like:

``` json
{
  "enabled": true,
  "mode": "strict-local",
  "provider": "ollama",
  "host": "127.0.0.1",
  "port": 11434,
  "basePath": "/v1",
  "model": "",
  "apiKey": "",
  "timeoutMs": 120000,
  "maxOutputTokens": 4096,
  "maxPromptTokens": 8192,
  "autoDetect": true,
  "ollamaPort": 11434,
  "lmStudioPort": 1234,
  "llamaCppPort": 8080
}
```

The exact active values depend on the selected provider and VS Code
settings.

------------------------------------------------------------------------

# 9. Operating Modes

## strict-local

Use this mode when you want local-only operation.

``` text
Local model
    │
    ▼
Copilot Smart
    │
    ▼
Local provider
```

There is no silent cloud fallback.

This is the recommended mode when your goal is to keep coding tasks
local.

------------------------------------------------------------------------

## local-preferred

Use this mode when you want local models first but are comfortable with
cloud fallback.

``` text
             ┌── Local model ──► success
             │
Task ────────┤
             │
             └── Cloud fallback
```

This mode is useful when the local model is unavailable or when the
workflow explicitly needs a cloud capability.

------------------------------------------------------------------------

# 10. Smart Local Task

The most powerful feature is:

``` text
Copilot Smart → Smart Local Task
```

Do not treat this as a simple chat prompt.

Smart Local Task is intended for larger coding jobs where the model
needs to understand the repository before changing code.

A good workflow is:

``` text
Open project
    ↓
Smart Local Task
    ↓
Repository analysis
    ↓
Project structure understanding
    ↓
Agent generation
    ↓
Implementation
    ↓
Testing
    ↓
Review
    ↓
Fix
```

------------------------------------------------------------------------

# 11. Project-Aware Agent Team

Smart Local Task can build a project-specific agent team instead of
using the same fixed agents for every repository.

For example, a Python project may produce agents such as:

``` text
Repository Analyst
Lead Architect
Python Architecture Specialist
Dependency Specialist
Implementation Engineer
Test Engineer
Error Handling Specialist
Security Reviewer
Performance Reviewer
Documentation Agent
Principal Reviewer
```

A TypeScript/React project can require a different set of specialists.

The objective is:

``` text
Repository
   ↓
Understand project
   ↓
Identify technologies
   ↓
Identify architecture
   ↓
Identify risks
   ↓
Generate appropriate agents
   ↓
Execute task
```

This makes the agent team specific to the project instead of relying on
a generic coding prompt.

------------------------------------------------------------------------

# 12. Repository Analysis

Before a large Smart Local Task, the project should be analyzed.

The analyzer considers:

-   Repository structure
-   Source files
-   Configuration
-   Build files
-   Dependency information
-   Documentation
-   Tests
-   Existing architecture
-   Relevant coding patterns

Large repositories are processed in multiple analysis passes rather than
attempting to put the entire repository into one model prompt.

This is important because local models have finite context windows.

------------------------------------------------------------------------

# 13. Efficient Use of Smart Local Task

For best results, give the task a clear objective.

### Good

``` text
Add support for Python 3.12.

Review the existing compatibility layer, identify incompatible APIs,
update the implementation, update tests, and run the existing test suite.
Do not change public APIs unless required.
```

### Better for a bug

``` text
Fix the crash when the configuration file is missing.

First identify where configuration loading happens.
Trace all callers.
Implement the smallest safe fix.
Add regression coverage.
Run the relevant tests.
Review the final diff.
```

### Avoid

``` text
fix everything
```

The more specific the objective, the better the generated agent plan can
be.

------------------------------------------------------------------------

# 14. Recommended Development Workflow

For normal coding:

``` text
1. Open repository
2. Discover local model
3. Select model
4. Test connection
5. Work on small changes normally
```

For complex work:

``` text
1. Open repository
2. Check Git status
3. Start Smart Local Task
4. Let repository analysis complete
5. Review generated task/agent plan
6. Allow implementation
7. Run tests
8. Review changes
9. Commit
```

------------------------------------------------------------------------

# 15. Git Safety

Even when using autonomous local agents, Git should remain the safety
boundary.

Before a large task:

``` bash
git status
```

Prefer starting from a clean working tree.

For example:

``` bash
git checkout -b feature/smart-local-task
```

Then let Smart Local Task make changes.

Review:

``` bash
git status
git diff
```

Run your tests.

Only then commit:

``` bash
git add .
git commit -m "Implement requested change"
```

For important repositories, use a dedicated feature branch rather than
running autonomous tasks directly on `main` or `develop`.

------------------------------------------------------------------------

# 16. Auto-Apply

Smart Local Task supports automatic application of implementation
changes.

The relevant setting is:

``` json
{
  "copilot-smart.smartTaskAutoApply": true
}
```

With auto-apply enabled, implementation agents can write changes
directly into the workspace.

Recommended usage:

### Trusted project branch

``` text
smartTaskAutoApply = true
```

### Production/shared branch

``` text
smartTaskAutoApply = false
```

Use Git branches and review changes before applying them when the
repository is sensitive.

------------------------------------------------------------------------

# 17. Agent Team Size

The maximum generated agent count can be controlled with:

``` json
{
  "copilot-smart.smartTaskMaxAgents": 12
}
```

Do not assume that more agents always means better performance.

A practical approach is:

``` text
Small task       → 3–5 agents
Medium task      → 5–8 agents
Large task       → 8–12 agents
```

The goal is to use enough specialization without wasting local model
compute on unnecessary agents.

------------------------------------------------------------------------

# 18. Choosing a Local Model

Model selection has a large impact on performance.

Prefer a model that is:

-   Good at code generation
-   Good at following structured instructions
-   Large enough for your available hardware
-   Fast enough for interactive development
-   Capable of handling your project's language
-   Able to work within your available context window

For large repositories, context size is particularly important.

A smaller model with good context handling can sometimes be more useful
than a larger model that cannot efficiently process the required project
context.

------------------------------------------------------------------------

# 19. Ollama Performance

For Ollama:

``` text
Ollama
  ↓
Local GPU / CPU
  ↓
Coding model
```

Keep the model loaded when possible for interactive work.

Check available models:

``` bash
ollama list
```

Check the server:

``` bash
curl http://127.0.0.1:11434/api/tags
```

Monitor the machine while running large tasks.

If generation is slow:

1.  Try a smaller coding model.
2.  Reduce unnecessary agent count.
3.  Avoid repeatedly analyzing unchanged repositories.
4.  Use targeted tasks instead of vague tasks.
5.  Keep unrelated applications from consuming GPU memory.

------------------------------------------------------------------------

# 20. Local Usage Logging

Copilot Smart maintains local usage information under:

``` text
~/.copilot-smart/local-usage.jsonl
```

This can be useful for understanding how much work is being handled
locally.

Use local logs to identify:

-   Local task activity
-   Model usage
-   Provider usage
-   Task frequency

The purpose is to make local-vs-cloud usage easier to understand.

------------------------------------------------------------------------

# 21. `provider.json`

Copilot Smart can generate:

``` text
provider.json
```

This is useful when integrating local provider information into
compatible Copilot/local-provider workflows.

Use:

``` text
Copilot Smart → Generate provider.json
```

The generated configuration reflects the selected local provider and
model settings.

------------------------------------------------------------------------

# 22. Best Practices

## Use local models for

-   Repository exploration
-   Code explanation
-   Refactoring
-   Boilerplate
-   Unit tests
-   Documentation
-   Debugging
-   Error analysis
-   Small feature implementation
-   Large repository-aware coding tasks
-   Code review
-   Performance analysis

## Use cloud models selectively for

-   Tasks where the local model cannot produce a satisfactory result
-   Extremely difficult reasoning tasks
-   Workflows requiring capabilities unavailable locally
-   Cases where local hardware cannot handle the required model/context

------------------------------------------------------------------------

# 23. Recommended Daily Workflow

A highly efficient daily workflow is:

``` text
                    START
                      │
                      ▼
               Open repository
                      │
                      ▼
                Check Git status
                      │
                      ▼
              Copilot Smart READY?
                      │
              ┌───────┴────────┐
              │                │
             YES               NO
              │                │
              │         Discover / Test
              │                │
              └───────┬────────┘
                      ▼
                Select model
                      │
                      ▼
              Small coding task?
                 /          \
               YES           NO
                │             │
                ▼             ▼
            Normal work   Smart Local Task
                              │
                              ▼
                       Analyze repository
                              │
                              ▼
                       Build agent team
                              │
                              ▼
                          Implement
                              │
                              ▼
                           Test
                              │
                              ▼
                           Review
                              │
                              ▼
                         Git diff
                              │
                              ▼
                           Commit
```

------------------------------------------------------------------------

# 24. Troubleshooting

## Status shows `SELECT MODEL`

Run:

``` text
Copilot Smart → Discover Models
```

For Ollama, verify:

``` bash
ollama list
```

and:

``` bash
curl http://127.0.0.1:11434/api/tags
```

Then select a model.

------------------------------------------------------------------------

## Ollama is not connected

Check:

``` powershell
netstat -ano | findstr :11434
```

Expected:

``` text
127.0.0.1:11434    LISTENING
```

Then test:

``` powershell
curl.exe http://127.0.0.1:11434/api/tags
```

------------------------------------------------------------------------

## Model list is empty

Check that Ollama actually has models:

``` bash
ollama list
```

Then use:

``` text
Discover Models
```

If the API returns models but Copilot Smart does not display them, check
the extension output/logs.

------------------------------------------------------------------------

## Settings opens multiple times

The current workflow is designed to reuse the existing Copilot Smart
Settings tab.

Clicking the status-bar icon should:

``` text
Settings already open
       ↓
Focus existing tab
       ↓
Refresh settings
```

rather than creating another Settings tab.

------------------------------------------------------------------------

# 25. Recommended Team Configuration

For a powerful local development workflow, start with:

``` json
{
  "copilot-smart.enabled": true,
  "copilot-smart.mode": "strict-local",
  "copilot-smart.provider": "ollama",
  "copilot-smart.host": "127.0.0.1",
  "copilot-smart.port": 11434,
  "copilot-smart.smartTaskMaxAgents": 8,
  "copilot-smart.smartTaskAutoApply": true
}
```

Adjust the model to one that performs well on your hardware.

------------------------------------------------------------------------

# 26. Philosophy

Copilot Smart is not intended to be just another chat panel.

The preferred workflow is:

``` text
                 UNDERSTAND
                     ↓
                  PLAN
                     ↓
                 SPECIALIZE
                     ↓
                 IMPLEMENT
                     ↓
                   TEST
                     ↓
                  REVIEW
                     ↓
                   FIX
                     ↓
                 VERIFY
```

The goal is to make the local model behave more like a **software
engineering team** than a single autocomplete engine.

------------------------------------------------------------------------

# 27. Quick Reference

  Task                       Action
  -------------------------- ----------------------------------------
  Open Control Center        Click Copilot Smart Activity Bar icon
  Configure provider         Open Settings
  Find local servers         Detect Local LLMs
  Find models                Discover Models
  Test provider              Test Connection
  Refresh state              Refresh Status
  Check configuration        Show Status
  Generate provider config   Generate `provider.json`
  Complex coding task        Smart Local Task
  Check local Ollama         `ollama list`
  Check Ollama API           `curl http://127.0.0.1:11434/api/tags`
  Check Git changes          `git diff`
  Check Git state            `git status`

------------------------------------------------------------------------

# 28. Summary

For the best Copilot Smart experience:

1.  Run a local coding model through Ollama, LM Studio, or llama.cpp.
2.  Discover and select the model.
3.  Keep the status-bar indicator in the **Ready** state.
4.  Use normal local assistance for small coding tasks.
5.  Use **Smart Local Task** for complex repository-wide work.
6.  Let the project-aware workflow analyze the repository before
    implementation.
7.  Use an appropriate number of generated agents rather than maximizing
    the agent count.
8.  Run tests after autonomous changes.
9.  Review the Git diff before committing.
10. Keep cloud fallback disabled when local-only operation is required.

Copilot Smart works best when the local model is treated as an
engineering system:

``` text
Repository
    ↓
Context
    ↓
Agents
    ↓
Implementation
    ↓
Tests
    ↓
Review
    ↓
Verified Code
```


# 29. Building the VSIX

The VSIX package can be built locally from the source repository.

## Prerequisites

Install Node.js and npm.

Verify:

```bash
node --version
npm --version
```

Install the VS Code Extension Manager (`vsce`):

```bash
npm install --global @vscode/vsce
```

Verify:

```bash
vsce --version
```

## Build the VSIX

Clone or check out the Copilot Smart source repository and enter the project directory:

```bash
cd copilot-smart-vscode
```

Install dependencies:

```bash
npm install
```

Before packaging, check the extension JavaScript:

```bash
node --check extension/extension.js
```

Then build the VSIX:

```bash
vsce package
```

This creates a file similar to:

```text
copilot-smart-2.2.2.vsix
```

The version is taken from `package.json`.

## Install the locally built VSIX

From VS Code:

```text
Ctrl+Shift+P
    ↓
Extensions: Install from VSIX...
    ↓
Select copilot-smart-<version>.vsix
```

Or from the command line:

```bash
code --install-extension copilot-smart-2.2.2.vsix
```

Then reload VS Code:

```text
Ctrl+Shift+P
    ↓
Developer: Reload Window
```

## Build and install in one workflow

A typical development workflow is:

```bash
npm install
node --check extension/extension.js
vsce package
code --install-extension copilot-smart-2.2.2.vsix
```

Then reload VS Code.

## Packaging checks

Before creating a release build, verify:

```bash
node --check extension/extension.js
```

Check the extension metadata:

```bash
cat package.json
```

Make sure the following are correct:

- `name`
- `displayName`
- `version`
- `main`
- `activationEvents`
- `contributes.commands`
- `contributes.viewsContainers`
- Activity Bar icon path
- Commands used by the extension

For example:

```json
{
  "main": "./extension/extension.js",
  "activationEvents": [
    "onStartupFinished",
    "onView:copilot-smart.controlCenter",
    "onCommand:copilot-smart.openSettings"
  ]
}
```

## Release checklist

Before committing a new VSIX release:

```text
[ ] Update version in package.json
[ ] Update README if behavior changed
[ ] Run npm install
[ ] Run node --check extension/extension.js
[ ] Run vsce package
[ ] Install the generated VSIX
[ ] Reload VS Code
[ ] Check Activity Bar icon
[ ] Check status-bar icon
[ ] Check Settings command
[ ] Detect local providers
[ ] Discover models
[ ] Select a local model
[ ] Test connection
[ ] Run Smart Local Task
[ ] Verify Git changes
```

## Important

The generated `.vsix` file is a distributable extension package. The source code remains the authoritative development version.

Do not commit large generated `.vsix` files to the source repository unless the project's release process specifically requires it. Prefer publishing the VSIX as a release artifact and keeping the source repository focused on the extension source and build configuration.

