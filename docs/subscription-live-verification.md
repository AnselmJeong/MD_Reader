# Real document verification — 2026-10-16

Both GPT (`codex:default`) and Claude (`claude:default`) answered through the installed `/Applications/MD Reader.app`, using their separately logged-in subscription profiles. Web search was off. Each provider received a fresh conversation and the same question about chapter 4 of `/Volumes/LIBRARY/Translated Books/dynamics-to-network.epub` (2,321 words).

## Issue found and fixed

The initial GPT attempt correctly said it had not received the chapter. A duplicate open of an already loaded EPUB replaced its store content with the empty file-loader content while the existing rendition's text cache prevented republishing the chapter. The footer consequently fell from 2,321 to zero words.

Reopening the same unchanged EPUB now preserves its rendered text, statistics and location. Changed files reset normally. Rendered-text updates also repair store/cache divergence and fall back to textContent when innerText is absent. The regression test verifies both duplicate-open preservation and changed-file reset.

## Source checks

| Check | Chapter evidence | GPT | Claude |
| --- | --- | --- | --- |
| Three layers | SC = parameters; attractors/bifurcations = state space; FC = observations (§4.1–4.4) | Pass | Pass |
| Exact quantities | 90 modeled regions; 89 healthy adult MEG participants (§4.2) | Pass | Pass |
| Controlled variables | Fixed connection strength/length; varied global coupling/conduction speed (§4.2) | Pass | Pass |
| Same SC implies same FC? | No; operating point and other dynamics matter (§4.5) | Pass | Pass |
| Instantaneous values sufficient with delay? | No; recent history over the delay is needed (§4.6) | Pass | Pass |
| Bipolar randomized trial sample size | Not given in this chapter | Correctly absent | Correctly absent |

Both completed replies were verified in the native UI and persisted SQLite records, each with the correct provider model ID and one user/one assistant message. GPT session: `session-3821ff2c-de26-4ea2-900f-360e85c96b8b`; Claude session: `session-4a6fcfe0-784f-4bf1-8812-eea970d89a13`.

The prompt also requested at most eight sentences. GPT followed this; Claude used eleven short sentences. Content accuracy passed for both, but Claude did not fully follow that formatting limit. This verifies this document/chapter and text workflow, not every model, document or image question.

Focused tests: 32 subscription checks plus Hindsight/migration and EPUB context regression checks. Main/preload and renderer typechecks, production build and diff whitespace checks passed.
