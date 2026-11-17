# Copilot Smart VS Code Extension

## Connection Status Indicator

The VS Code status bar now shows the current connection state:

- `$(vm-active) LOCAL` — configured local LLM is reachable.
- `$(cloud) CLOUD` — GitHub Copilot extension is detected when local-preferred mode has no local connection.
- `$(vm-off) OFFLINE` — local LLM is unavailable in strict-local mode.
- `$(warning) NO LLM` — neither the configured local server nor GitHub Copilot was detected.

The indicator refreshes automatically every 10 seconds and can be clicked to open Copilot Smart Settings. In `strict-local` mode, the indicator always prioritizes the local LLM and explicitly shows that cloud fallback is disabled.


Copilot Smart 2.1.0 is a VS Code extension for routing coding assistance to local LLM servers.

## Supported local servers

- Ollama — default `127.0.0.1:11434`
- LM Studio — default `127.0.0.1:1234`
- llama.cpp — default `127.0.0.1:8080`
- Any OpenAI-compatible HTTP endpoint

## Install

Install the generated `.vsix` from VS Code:

```bash
code --install-extension copilot-smart-2.1.0.vsix
```

Or use **Extensions → ... → Install from VSIX...**

## Configure

Open the Command Palette:

```text
Copilot Smart: Open Settings
```

The settings panel lets you configure:

- provider
- host and port
- base path
- model
- API key
- strict-local mode
- timeout
- output token limit
- Ollama / LM Studio / llama.cpp detection ports

## Commands

- `Copilot Smart: Open Settings`
- `Copilot Smart: Detect Local LLMs`
- `Copilot Smart: Discover Models`
- `Copilot Smart: Test Connection`
- `Copilot Smart: Generate provider.json`
- `Copilot Smart: Status`
- `Copilot Smart: Start Local Task`

## Strict-local mode

`strict-local` is the recommended mode when the goal is to avoid accidental cloud fallback. If the local endpoint is unavailable, Copilot Smart fails instead of silently using a cloud model.

## Files

Configuration:

`~/.copilot-smart/config.json`

Usage log:

`~/.copilot-smart/local-usage.jsonl`

Provider registry:

`~/.copilot/providers.json`

You can override the provider registry location with:

```text
COPILOT_PROVIDERS_CONFIG
```

## Ollama example

Start Ollama and make sure a model is available:

```bash
ollama serve
ollama list
```

Then use **Copilot Smart: Discover Models**, select the model, and run **Test Connection**.

## Important

This VS Code extension is the VS Code companion/package version of the earlier Copilot CLI extension. It does not replace GitHub Copilot itself; it provides a local-LLM control layer and generates the local provider configuration used by compatible Copilot tooling.


## Extension Icon

Copilot Smart uses the included `icon.png` as its VS Code extension icon.


## Copilot Smart Activity Bar

Copilot Smart now adds a dedicated icon to the **left Activity Bar** in VS Code.

The **Control Center** provides one-click access to:

- Open Settings
- Detect Local LLMs
- Discover Models
- Test Connection
- Refresh Status
- Generate `provider.json`
- Start Local Task
- Show Status

The bottom-right VS Code status bar continues to show the live local/cloud connection state.


### Model list in Control Center

The Activity Bar Control Center now shows a **Models** dropdown. It automatically queries:
- Ollama `/api/tags`
- LM Studio `/v1/models`
- llama.cpp `/v1/models`

Use **Refresh Models** after starting your local server. Selecting a model automatically saves it as the active Copilot Smart model.


## Model Discovery

v2.1.4 improves model discovery for Ollama, LM Studio, llama.cpp, and custom OpenAI-compatible local servers. Models are shown directly in the Settings panel and the Activity Bar Control Center.

## Status Bar Indicator

The status bar now has a prominent **Copilot Smart** connection indicator:

- 🟢 **READY TO ROCK** — local model is connected and selected.
- 🟡 **CONNECTING...** — connection check is in progress.
- 🟡 **AUTHENTICATION** — the local server or cloud Copilot is waiting for authentication.
- 🟡 **SELECT MODEL** — local server is connected but no model has been selected.
- 🔴 **NOT CONNECTED** — the local server is unavailable.
- 🟢 **CLOUD READY** — local-preferred mode is using an active GitHub Copilot installation.

The indicator is clickable and opens Copilot Smart Settings.

## Smart Local Task

Use **Copilot Smart: Smart Local Task** from the Activity Bar to run an autonomous local coding workflow. It scans the workspace, analyzes the project in context-sized passes, generates project-specific specialist agents, coordinates implementation and review, applies implementation changes locally, runs an unambiguous project-native test command when available, and stores the run report under `.copilot-smart/agent-runs/`.

The workflow is local-only and uses the selected local model. Configure `copilot-smart.smartTaskMaxAgents` to control the maximum team size and `copilot-smart.smartTaskAutoApply` to control automatic application of implementation/fixer changes.
