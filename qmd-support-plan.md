# QMD reading support

Implement a static Quarto reader on the existing Markdown path, preserving source text for saving and existing Markdown/EPUB behavior.

- Accept `.qmd` in the native picker and all drop targets.
- Parse YAML metadata safely (including structured authors and CRLF/BOM input).
- Render explicit heading IDs, local section links, figure attributes/captions, pipe-table captions, fenced divs/callouts, and local cross-references before bibliography citations.
- Keep code cells visible as source, without executing R/Python or invoking Quarto.
- Resolve local images relative to the opened document and keep the TOC aligned with rendered heading IDs.
- Verify with parser regressions, TypeScript checks, production build, and an isolated Electron smoke test using a QMD fixture.

Full Quarto publishing (code execution, project/book cross-references, extensions, generated plots, and output-format-specific layouts) is outside this reader's scope.

Syntax reference: https://quarto.org/docs/guide/

## Completed and verified

Implemented the above scope with no new dependencies. QMD remains on the Markdown document/storage path; a QMD-specific AST pass handles display syntax. YAML bibliography paths (including multiple `.bib` files) resolve relative to the document, with manual bibliography selection retaining precedence.

Validation:
- 19 parser/citation/bibliography tests passed.
- Both renderer and main TypeScript checks passed.
- Production build passed.
- Isolated Electron smoke passed: native picker, structured metadata, relative SVG decoding, captions, cross-reference scrolling without navigation, TOC IDs, declared/custom/missing bibliography cases, and unchanged source saving.
- Screenshots inspected at `.tmp/quarto-smoke.png` and `.tmp/quarto-figures.png`.
- `git diff --check` passed.

Try `examples/quarto/reading.qmd` with its sibling `figure.svg`.

Reader limitations: execution-generated output is unavailable unless supplied as a static image/table; unresolved references remain readable and are not converted into bibliography citations. Advanced Pandoc table formats, subfigure numbering/layout, project configuration, and cross-document book references are not implemented. Local section references use their heading text as the link label.
