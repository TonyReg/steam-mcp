# Windows-First Steam MCP V1

This repository implements the approved Windows-first Steam MCP v1 scaffold.

Key contract highlights:

- local `stdio` MCP transport only
- thin `packages/steam-mcp` wrapper
- Steam logic lives in `packages/steam-core`
- authoritative v1 collection backend is `cloud-storage-namespace-1.json`
- `sharedconfig.vdf` is not primary
- collection apply is experimental, opt-in, backup-first, atomic, drift-checked, and rollback-capable
- MCP-owned durable plan, backup, and log artifacts may be persisted outside the repo; only `steam_collection_apply` mutates Steam-owned state

See the locked design source in the planning archive for the full contract text.
