# PRD: MD Reader — Academic Markdown Reader with AI Assistant

## 1. Overview

**MD Reader**는 신경과학 및 정신의학 분야의 학술 Markdown 문서를 아름답게 렌더링하고, 문서 내용에 대해 AI와 대화할 수 있는 데스크탑/웹 애플리케이션이다.

핵심 철학: **Read beautifully, Ask intelligently.**

---

## 2. Problem Statement

학술 Markdown 문서(특히 수식, 참고문헌, 그림이 포함된 신경과학 논문)를 읽을 때 다음과 같은 문제가 존재한다:

- 일반 Markdown 뷰어는 LaTeX 수식 렌더링이 불안정하거나 지원하지 않음
- 학술 문서 특유의 구조(abstract, citation, figure caption 등)에 최적화된 뷰어가 없음
- 문서를 읽으며 즉시 AI에게 질문하고 싶을 때, 별도 앱을 오가야 하는 마찰이 큼
- AI와 나눈 대화(문서에 대한 해석, 요약 등)를 체계적으로 보존하기 어려움

---

## 3. Target Users

| Persona | Description |
|---|---|
| **연구자** | 논문·교과서 원고를 Markdown으로 작성/관리하며, 수식·참고문헌이 많은 문서를 자주 읽는 post-doc, PhD |
| **임상가-학자** | 정신의학·신경과학 리뷰 논문을 읽으며 핵심 개념을 빠르게 파악하고 싶은 임상의 |
| **학생** | 복잡한 학술 텍스트를 AI 도움으로 이해하고 싶은 대학원생 |

---

## 4. Core Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Toolbar                                                     │
├──────────────────────────────┬──────────────────────────────┤
│                              │  AI Chat Panel               │
│   Document Reader Pane       │  ┌──────────────────────┐   │
│                              │  │ Chat messages         │   │
│   - Rendered Markdown        │  │                       │   │
│   - KaTeX math               │  │                       │   │
│   - Citations                │  │                       │   │
│   - Figures                  │  │                       │   │
│   - Table of Contents (FAB)  │  ├──────────────────────┤   │
│                              │  │ Quick Actions         │   │
│                              │  ├──────────────────────┤   │
│                              │  │ Input + Send          │   │
├──────────────────────────────┴──────────────────────────────┤
│  Status Bar: filename · word count · reading time · zoom     │
└─────────────────────────────────────────────────────────────┘
```

- **좌측 (≈60–70%)**: Document Reader — Markdown 렌더링 전용
- **우측 (≈30–40%)**: AI Chat Panel — 문서에 대한 질의응답
- **Divider**: 드래그로 비율 조절 가능, 더블클릭 시 Chat 패널 접기/펼치기

---

## 5. Feature Specification

### 5.1 Document Reader Pane

#### 5.1.1 Markdown Rendering Engine

| Feature | Detail |
|---|---|
| **기본 렌더링** | CommonMark + GFM (tables, task lists, strikethrough, footnotes) |
| **수식** | KaTeX 기반. 인라인(`$...$`) 및 블록(`$$...$$`) 모두 지원. 수식 번호 자동 부여 (`\tag{}`, `\label{}`, `\ref{}`) |
| **코드 블록** | Syntax highlighting (highlight.js / Shiki). 신경과학에서 자주 쓰는 Python, R, MATLAB, Julia 우선 지원 |
| **Mermaid** | Mermaid 다이어그램 인라인 렌더링 (neural circuit diagram 등) |
| **이미지** | 로컬/원격 이미지. 클릭 시 lightbox 확대. Figure caption 스타일링 |
| **표** | GFM 테이블 + 긴 테이블 가로 스크롤. 헤더 고정(sticky header) |
| **각주/미주** | 호버 시 팝오버로 미리보기, 클릭 시 스크롤 이동 |
| **YAML Front Matter** | 파싱하여 문서 상단에 메타데이터 카드로 표시 (title, authors, date, keywords, abstract) |

#### 5.1.2 학술 문서 특화 기능

- **Citation 렌더링**: `[@author2024]` 스타일의 Pandoc citation을 인식하여 스타일링. BibTeX/CSL-JSON 파일 연동 시 호버로 전체 서지정보 팝오버 표시
- **Cross-reference**: `{#fig:name}`, `{#eq:name}`, `{#sec:name}` 등 Pandoc 스타일 상호참조 지원
- **Abstract 블록**: `> [!abstract]` 또는 YAML의 abstract 필드를 별도 디자인 블록으로 렌더링
- **Callout/Admonition**: `> [!note]`, `> [!warning]`, `> [!important]`, `> [!definition]`, `> [!theorem]` 등 학술 문서에 유용한 callout 블록

#### 5.1.3 Typography & Visual Design

- **서체**: Serif 본문 (Noto Serif KR + Latin serif), Sans-serif 헤딩. 수식은 KaTeX 기본 폰트
- **줄간격**: 1.6–1.8 (학술 문서 가독성 최적화)
- **문단 간격**: 적절한 여백으로 시각적 호흡
- **다크/라이트 모드**: 자동 감지 + 수동 전환. Sepia 모드 추가 (장시간 독서용)
- **테마**: 최소 3종 — `Academic Light`, `Sepia Classic`, `Dark Scholar`
- **폰트 크기 조절**: 14px–22px 범위 슬라이더 또는 Ctrl+/Ctrl-
- **본문 최대 너비**: 약 72ch (가독성 최적 line length), 센터 정렬

#### 5.1.4 Navigation

- **Table of Contents (ToC)**:
  - 플로팅 버튼 클릭 시 좌측 오버레이로 표시
  - 현재 읽고 있는 섹션 하이라이트
  - 클릭 시 smooth scroll 이동
  - 중첩 수준(H1–H4) 들여쓰기
- **Reading Progress**: 상단에 얇은 프로그레스 바
- **Back to Top**: 스크롤 내리면 나타나는 FAB
- **섹션 간 이동**: 키보드 단축키 (PageUp/PageDown 또는 `[`/`]`)
- **텍스트 검색**: Ctrl+F로 문서 내 검색, 하이라이트 표시

#### 5.1.5 텍스트 선택 시 컨텍스트 메뉴

문서에서 텍스트를 드래그 선택하면 다음 옵션이 포함된 floating toolbar 표시:

- **"AI에게 질문"** → 선택 텍스트를 Chat에 인용하여 자동 질문 생성
- **"요약 요청"** → "이 부분을 요약해줘" 프롬프트 자동 전송
- **"용어 설명"** → "이 용어/개념을 설명해줘" 프롬프트 자동 전송
- **"복사"** → 클립보드에 Markdown 원문 복사
- **"하이라이트"** → 형광펜 효과 (세션 내 유지, 선택적으로 저장)

---

### 5.2 AI Chat Panel

#### 5.2.1 기본 대화 기능

- **LLM 연동**: Ollama를 사용하며, ollama list에서 불리워진 model 중 선택 가능.  Settings에서 모델 설정
- **System prompt**: 문서 내용 전체(또는 청크)를 system/context로 자동 주입. 사용자가 커스텀 system prompt 추가 가능
- **Streaming 응답**: 토큰 단위 실시간 표시
- **대화 내 Markdown 렌더링**: AI 응답에 포함된 수식, 코드, 표도 KaTeX + syntax highlighting으로 렌더링
- **대화 내 수식 렌더링**: Chat 메시지 내 `$...$`, `$$...$$` KaTeX 렌더링

#### 5.2.3 문서 컨텍스트 인식

- **전체 문서**: 전체 문서가 context로 전달되는 것은 맞지만
- **선택 텍스트 인용**: Reader에서 선택한 텍스트가 Chat에 blockquote로 삽입되어 선택된 맥락에 대한 specific한 질문 가능
- 

#### 5.2.4 대화 관리

- **대화 내보내기 (Export)**:
  - 개별 메시지 복사 (Markdown 형식) - 메시지 액션
  - 전체 대화 Markdown 파일로 다운로드
- **대화 초기화**: "New Chat" 버튼으로 대화 리셋 (이전 대화는 히스토리에 보존)
- **대화 히스토리**: 동일 문서(filename으로 구분)에 대한 이전 대화 세션 목록 및 복원

### 5.3 파일 관리

#### 5.3.1 문서 열기

- **로컬 파일 열기**: `.md`, `.markdown`, `.txt` 파일 열기 (드래그 앤 드롭 지원)
- **최근 파일 목록**: 최근 열었던 파일 빠른 접근
- **폴더 열기**: 디렉토리 지정 시 사이드바에 파일 트리 표시 (라이브러리 모드)
- **BibTeX 연동**: `.bib` 파일을 같은 디렉토리 또는 수동 지정으로 로드

### 5.4 Annotation & Highlights

- **하이라이트**: 4가지 색상 (Yellow, Green, Blue, Pink)
- **인라인 메모**: 하이라이트에 짧은 메모 첨부 가능
- **Annotation 패널**: 모든 하이라이트와 메모를 목록으로 보기
- **Annotation 내보내기**: Markdown 형식으로 내보내기 (하이라이트 텍스트 + 메모 + 위치정보)
- **저장**: 문서별 `.neuroreader.json` 사이드카 파일에 저장 (원본 미수정)

---

### 5.5 Toolbar & Settings

#### Toolbar (상단 바)

```
[📂 Open] [📁 Library] | [ToC] [🔍 Search] | [A- A+] [Theme 🌙] | [⚙ Settings]
```

#### Settings (모달 또는 별도 패널)

- **AI 설정**: Ollama Model 선택, Custom system prompt
- **렌더링 설정**: 테마, 폰트, 폰트 크기, 줄간격, 본문 너비

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | 파일 열기 |
| `Ctrl+F` | 문서 내 검색 |
| `Ctrl+Shift+T` | ToC 토글 |
| `Ctrl+/` | Chat 패널 토글 |
| `Ctrl+=` / `Ctrl+-` | 폰트 크기 조절 |
| `Ctrl+Shift+D` | 다크/라이트 모드 전환 |
| `Ctrl+Enter` | Chat 메시지 전송 |
| `Ctrl+Shift+E` | 대화 내보내기 |
| `[` / `]` | 이전/다음 섹션 이동 |
| `Esc` | 패널/모달 닫기 |

---

## 7. Technical Architecture

### 7.1 Technology Stack (권장)

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Electron + React | 크로스 플랫폼 데스크탑 앱. |
| **Markdown Parser** | unified (remark + rehype) | 플러그인 확장 가능한 파이프라인 |
| **Math Rendering** | KaTeX | MathJax 대비 빠른 렌더링 속도 |
| **Syntax Highlighting** | Shiki | VS Code 동일 문법, 정확한 토큰화 |
| **Mermaid** | mermaid.js | 다이어그램 렌더링 |
| **Citation** | citeproc-js + CSL | Pandoc 호환 citation 처리 |
| **State Management** | Zustand | 경량, 간결 |
| **Styling** | Tailwind CSS + CSS Variables | 테마 전환 용이 |
| **AI Integration** | Ollama AI SDK |  |
| **Storage** | SQLite (better-sqlite3) / JSON | 대화 히스토리, 설정, 어노테이션 |

### 7.2 Rendering Pipeline

```
Markdown Source
  → remark-parse (AST)
  → remark-math (수식 노드 추출)
  → remark-gfm (GFM 확장)
  → remark-frontmatter (YAML)
  → remark-citation (커스텀 플러그인)
  → remark-rehype (HTML AST 변환)
  → rehype-katex (수식 렌더링)
  → rehype-shiki (코드 하이라이트)
  → rehype-mermaid (다이어그램)
  → rehype-stringify (HTML 출력)
  → React component tree
```

## 8. Design Principles

1. **Content First**: UI는 문서 내용을 방해하지 않는다. 
2. **Academic Elegance**: LaTeX 문서 수준의 타이포그래피 품질을 Markdown에서 구현.
3. **Frictionless AI**: 읽다가 궁금한 순간, 한 번의 클릭/단축키로 AI에게 질문.
4. **Non-destructive**: 원본 파일은 절대 수정하지 않음. 모든 부가 데이터는 사이드카 파일.
5. **Offline-capable**: 로컬 LLM(Ollama) 연동 시 인터넷 없이도 모든 기능 사용 가능.

---

## 9. MVP Scope (Phase 1)

Phase 1에서 구현할 최소 기능:

- [x] Markdown 파일 열기 (로컬 파일, 드래그 앤 드롭)
- [x] 고품질 Markdown 렌더링 (KaTeX, GFM, 코드 하이라이트)
- [x] 라이트/다크/세피아 테마
- [x] Table of Contents
- [x] AI Chat 패널 (OpenAI / Anthropic API 연동)
- [x] Quick Actions (Summarize, Analyze, Key Concepts)
- [x] 텍스트 선택 → AI에게 질문
- [x] 대화 내보내기 (Markdown)
- [x] 개별 메시지 복사

### Phase 2

- [ ] BibTeX/CSL citation 렌더링
- [ ] 하이라이트 & 어노테이션
- [ ] 대화 히스토리 (문서별)
- [ ] 폴더/라이브러리 모드
- [ ] Live reload (파일 감시)
- [ ] Ollama 로컬 모델 지원

### Phase 3

- [ ] Cross-reference 지원
- [ ] Annotation 내보내기
- [ ] 커스텀 CSS 테마
- [ ] 다중 문서 탭

---

## 11. Appendix: 렌더링 예시

### 수식 렌더링
인라인 수식: `$F = -\nabla V(x)$` → 깔끔한 인라인 렌더링

블록 수식:
```
$$
\frac{\partial p(\mathbf{x}, t)}{\partial t} = -\nabla \cdot [\mathbf{f}(\mathbf{x}) p(\mathbf{x}, t)] + D \nabla^2 p(\mathbf{x}, t)
$$
```
→ 중앙 정렬, 수식 번호, 충분한 상하 여백

### Callout 블록
```markdown
> [!definition] Free Energy Principle
> 모든 자기조직화 시스템은 자유 에너지(variational free energy)의 
> 상한을 최소화하는 방향으로 작동한다.
```
→ 아이콘 + 배경색 + 제목 스타일링된 박스

### Citation
```markdown
선행 연구에 따르면 [@Friston2010; @Clark2013], 예측 부호화는...
```
→ "(Friston, 2010; Clark, 2013)" 형태로 렌더링, 호버 시 전체 서지정보
