# GPT and Claude subscription migration

MD Reader is an Electron/React app. This change removes Ollama from all runtime paths and replaces it with Codex (ChatGPT subscription) and Claude Code (Claude subscription). Chat, image questions, titles, search-query preparation, and memory extraction share the subscription adapter. TinyFish remains the separate, explicitly enabled web-search service.

## Integration

- Installed protocols inspected: Codex 0.160.0 and Claude Code 2.1.296. Codex stable and experimental TypeScript schemas were generated locally. Claude integration requires 2.1.273 or later for safe mode.
- Both official CLIs run without a shell, with an environment allowlist and private auth folders beneath Electron's `userData/codex` and `userData/claude`. No auth files are imported from other apps. CLI discovery covers standard macOS locations independently of Terminal PATH.
- Each GPT completion owns its own app-server process; status/login owns a separate connection. Claude uses one process per completion. Shutdown, cancellation, process errors, and deadlines stop owned processes.
- MD Reader owns the history. Each request carries explicit role-labelled history, app system instructions, validated native image blocks, and document/search context. Threads are ephemeral. JSON helpers validate returned JSON objects. Unavailable temperature controls have been removed from callers.
- Codex environment access and dynamic tools are empty; shell, browser, computer, images, agents, apps, hooks, plugins, skills discovery and web tools are disabled. Unexpected app-server requests receive errors. Claude uses safe mode, empty tools, empty strict MCP config, disabled hooks, a scratch workspace and no session persistence.
- GPT model discovery is account-specific and paginated; names store inference slugs with a `codex:` prefix. Both providers have an explicit `:default` selection. Claude also offers the official `sonnet`, `opus`, and `haiku` aliases; availability is ultimately checked by Claude.
- All completion failures stop at the selected provider; there is no HTTP LLM client or paid API fallback. GPT requires an affirmative `ordinaryUsageAllowed` response, plus non-exhausted applicable account/model windows. Unknown eligibility blocks generation. Claude validates first-party subscription auth and handles rate-limit/overage events. Provider-side additional-usage settings remain account controlled; local checks are not an atomic billing cap.
- GPT efforts unsupported by the chosen model use its catalog default. Claude maps None to Low; the UI explains both behaviors.

## Migration and user experience

Ollama credentials/base URL and the previous model preference are removed from MD Reader's settings. The initial selection becomes `codex:default`. Search keys, reading preferences, custom instructions, documents and chat history remain intact. Old memory-extraction model names fall back to the current subscription model. Global Ollama software and other applications are outside this repository migration.

Settings provides both account cards, sign-in, cancel, logout, refresh, model selection and quota/error display. Official OAuth requires the user to complete sign-in once for each private app profile. CLI credentials never enter the renderer. Selecting a model records its provider in the same persisted model ID, avoiding provider/model mismatch.

## Verification

- Main/preload and renderer TypeScript checks pass.
- 32 deterministic subscription checks cover UTF-8, pre-response events, duplicate final output, tool request rejection, auth, quota, malformed frames, crashes, timeouts, cancellation, independent workers, images, settings migration, and no HTTP fallback across generation paths.
- Electron UI smoke checks in the installed workspace covered model selection, search/effort, TinyFish settings and KaTeX. Additional image UI and scrolling checks were run alongside separate, uncommitted workspace features; those features are outside this migration commit.
- After user login, both providers generated real document-grounded responses in the installed app. See [live verification](subscription-live-verification.md).
- Build output uses bundled renderer resources. Unrelated workspace changes are preserved separately from this migration.

Run the focused suite using `npm run test:subscriptions`. Run UI fixtures after `npm run build` using the commands at the top of each smoke file.

## Installed delivery — 2026-10-16

- Installed and launched `/Applications/MD Reader.app`; the actual installed bundle passed the packaged smoke test with a restricted PATH and a temporary profile.
- Previous bundle preserved at `/Users/anselm/Library/Application Support/md-reader-backups/20261016-223757/MD Reader.app`.
- Installed `app.asar` SHA-256: `ca6459efb99b809c2b0e26e752ec3313a41a6175efee1fcfa3b21085380964e4`.
- Native UI inspection on the real profile confirmed GPT/Claude sign-in cards, preserved reading/search settings and custom system prompt, and the persisted subscription model. Old Ollama credentials and preference keys are absent.
- Subsequent user login and real document generation passed for both app-private accounts; see the live verification report below.
- Packaging used the repository's existing unsigned local build configuration; no notarization or publishing was performed.
- General Node tests: 42 passed directly; the bibliography test needs bundling for extensionless TypeScript imports, and all 3 cases passed after bundling.

## Subsequent live verification and Hindsight update

See [subscription live verification](subscription-live-verification.md) and [Hindsight memory](hindsight-memory.md) for the current installed revision and the EPUB context fix. The hash above identifies the initial subscription build.
