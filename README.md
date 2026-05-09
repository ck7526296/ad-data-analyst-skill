# ad-data-analyst-skill

Codex skill for advertising operations diagnosis.

## Install

Use this GitHub tree URL in Codex:

```text
https://github.com/ck7526296/ad-data-analyst-skill/tree/main/ad-data-analyst
```

Then add the MCP server:

```bash
codex mcp add adData -- node "$HOME/.codex/skills/ad-data-analyst/local-mcp/dist/server.js"
```

The local MCP proxy requires Node.js 18 or newer. It connects to `https://emi.qiongzhoukj.cn/qz/mcp` by default and stores successful ad backend logins in an encrypted local file at `~/.codex/ad-data-analyst/credentials.json`. Its local encryption key is stored at `~/.codex/ad-data-analyst/credential.key`.

After installation and MCP setup, restart Codex so the new skill and tools are discovered.
