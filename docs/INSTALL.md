# Install guide — from zero to an AI ABAP consultant in your editor

This guide assumes nothing: not that you've used AI coding tools, not that you know what MCP is.
Ten minutes, and your editor's AI assistant can lint ABAP, grade Clean Core readiness, plan
migrations, and scaffold RAP objects — **without an SAP system, credentials, or your code ever
leaving your machine** (the analysis is 100% local; only your chat with the AI assistant itself
goes wherever that assistant normally sends it).

Jump to: [VS Code](#vs-code) · [Eclipse / ADT](#eclipse--adt) · [Check it works](#check-it-works) ·
[Troubleshooting](#troubleshooting)

---

## The one prerequisite: Node.js

abap-mcp runs on Node.js (a free, standard developer runtime — the same thing SAP's own UI5
tooling uses).

1. Check if you already have it: open a terminal (VS Code: **Terminal → New Terminal**;
   Windows: Start → type `cmd`) and run:
   ```bash
   node --version
   ```
2. If that prints `v20` or higher — you're done, skip ahead.
3. Otherwise install the LTS version from **[nodejs.org](https://nodejs.org)** (click the big
   green button, accept the defaults), then reopen your terminal and check again.

You never need to install abap-mcp itself — `npx` (part of Node.js) fetches and runs the current
version automatically each time.

---

## VS Code

You need VS Code **1.102 or newer** with the **GitHub Copilot** extension signed in
(a free Copilot plan is enough).

**Option A — one click (easiest).** Click this badge and confirm when VS Code opens:

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_abap--mcp-0098FF?logo=githubcopilot&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=abap-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22abap-mcp%22%5D%7D)

**Option B — one command.** In any terminal:

```bash
npx abap-mcp setup
```

It finds VS Code (and Claude Code, if you use that) and registers the server for you. That's it.

**Option C — for your whole team.** Copy
[`examples/vscode/mcp.json`](../examples/vscode/mcp.json) into your abapGit repo as
`.vscode/mcp.json` and commit it. Every teammate who opens the folder gets abap-mcp offered
automatically — nobody installs anything by hand.

**Optional extra:** the [ABAP MCP VS Code extension](https://github.com/palimkarakshay/abap-mcp-vscode/releases)
adds right-click editor commands (Lint, Cloud Readiness, Scaffold…) whose findings land in the
Problems panel — download the `.vsix` from its releases page, then Extensions view → `…` menu →
**Install from VSIX…**.

Now [check it works](#check-it-works).

---

## Eclipse / ADT

Honest note first: **plain ADT has no way to plug in AI tools like this one.** The supported
path is the **GitHub Copilot plugin for Eclipse**, which does. (You'll need a GitHub account
with Copilot — the free plan works.)

1. **Install Copilot:** in Eclipse, **Help → Eclipse Marketplace…**, search **"GitHub Copilot"**,
   click **Install**, restart Eclipse when prompted.
2. **Sign in:** click the Copilot icon in the status bar (bottom of the window) → sign in with
   your GitHub account.
3. **Add abap-mcp:** Copilot icon → **Edit preferences** → **MCP**, and paste:
   ```json
   {
     "servers": {
       "abap-mcp": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "abap-mcp"]
       }
     }
   }
   ```
   Apply and close. (Menus move — if yours looks different, follow
   [GitHub's own steps for Eclipse](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/extend-copilot-chat-with-mcp?tool=eclipse).)
4. **Open Copilot Chat** (Copilot icon → Open Chat), switch it to **Agent** mode.

Prefer the terminal? `npx abap-mcp setup eclipse` prints these exact steps and the JSON block,
ready to paste.

Now check it works ↓

---

## Check it works

In your assistant's chat (Copilot **Agent mode** / Claude Code), ask:

> list your ABAP tools

You should see twelve, `lint_abap` through `get_abap_outline`. Then try it on real code:

> Here's one of my classes — lint it against ABAP Cloud and explain the worst finding like I'm
> new to ABAP.

or, pointed at a checked-out abapGit repo:

> How cloud-ready is this repo? Grade it and plan the migration in phases.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `node: command not found` / `npx` not recognized | Install Node.js LTS from [nodejs.org](https://nodejs.org), then **reopen** the terminal/editor. |
| The tools don't appear in chat | Make sure chat is in **Agent** mode (not plain Ask), then restart the editor once. In VS Code, run **MCP: List Servers** from the Command Palette — abap-mcp should be listed. |
| First call is slow | Normal: `npx` downloads the package on first use (~seconds). After that it's cached. |
| Corporate proxy blocks `npx` | Install once instead: `npm install -g abap-mcp`, and use `"command": "abap-mcp"` with `"args": []` in the config. |
| "Is my ABAP being uploaded somewhere?" | No. abap-mcp makes zero network calls — parsing, scoring and scaffolding run locally. Only your conversation with the AI assistant goes to that assistant's own service, as it does with or without abap-mcp. |

Stuck anyway? [Open an issue](https://github.com/palimkarakshay/abap-mcp/issues) — include your
editor + `node --version`.
