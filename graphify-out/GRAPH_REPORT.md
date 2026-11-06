# Graph Report - mint  (2026-11-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 543 nodes · 1039 edges · 30 communities (23 shown, 3 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3f0fc1af`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25

## God Nodes (most connected - your core abstractions)
1. `App()` - 52 edges
2. `$` - 25 edges
3. `renderCatFrame()` - 22 edges
4. `CatView` - 19 edges
5. `SessionStore` - 19 edges
6. `WorkspaceTools` - 19 edges
7. `WorkspaceTools` - 18 edges
8. `compilerOptions` - 17 edges
9. `initCatPlayground()` - 16 edges
10. `SessionStore` - 14 edges

## Surprising Connections (you probably didn't know these)
- `CatView` --references--> `CatExpression`  [EXTRACTED]
  website/src/lib/cat-view.ts → src/cat-art.ts
- `CatView` --references--> `CatMood`  [EXTRACTED]
  website/src/lib/cat-view.ts → src/cat-art.ts
- `CatState` --references--> `CatExpression`  [EXTRACTED]
  website/src/features/cat.ts → src/cat-art.ts
- `ExpressionInfo` --references--> `CatExpression`  [EXTRACTED]
  website/src/features/cat.ts → src/cat-art.ts
- `CatViewOptions` --references--> `CatExpression`  [EXTRACTED]
  website/src/lib/cat-view.ts → src/cat-art.ts

## Import Cycles
- None detected.

## Communities (30 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (60): AgentLoopLimits, AgentTurnBudget, DEFAULT_AGENT_LOOP_LIMITS, formatAgentLimits(), formatLimitMessage(), LimitReached, RepeatedCallGuard, CAT_EXPRESSIONS (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): buildSystemPrompt(), executeModelTool(), getCapabilities(), getModelTools(), HarnessCapability, stringProperty(), ToolExecution, CAT_EXPRESSIONS (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (18): ChatChunk, ChatMessage, ChatStreamEvent, FetchLike, FunctionTool, ModelsResponse, NvidiaClient, ToolCall (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (34): AARenderer, CAT_ART_FRAMES, CAT_ART_SIZE, CatArtOptions, CatExpression, CatMood, Color, drawArc() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (29): initApproval(), defaultState(), EXPRESSION_IDS, expressionMood(), EXPRESSIONS, initCatPlayground(), loadState(), PET_MESSAGES (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (17): buildUnifiedDiff(), normalizeLines(), UnifiedDiff, DiffHunk, DiffLine, DOC_MARKERS, IGNORED_DIRS, insideRoot() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (13): DOC_MARKERS, IGNORED_DIRS, insideRoot(), isSensitive(), makePreview(), PendingWrite, PROJECT_MARKERS, SENSITIVE_NAMES (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (24): typescript, @fontsource-variable/newsreader, @fontsource/victor-mono, gsap, @types/node, vite, dependencies, @fontsource-variable/newsreader (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (14): buildSystemPrompt(), executeModelTool(), getCapabilities(), getModelTools(), HarnessCapability, stringProperty(), SystemPromptState, ToolExecution (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (16): author, bin, minth, bugs, url, description, files, homepage (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.32
Nodes (11): ProposalCard(), extractDiffFile(), flushText(), isDiffMetaLine(), looksLikeDiff(), MessageSegment, normalize(), parseDiffBlock() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.20
Nodes (9): @opentui/solid, solid-js, @types/bun, description, zod, name, private, type (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (6): scripts, check:windows, dev, start, test, typecheck

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (6): scripts, check:windows, dev, start, test, typecheck

### Community 18 - "Community 18"
Cohesion: 0.40
Nodes (4): __dirname, __filename, mainPath, proc

### Community 19 - "Community 19"
Cohesion: 0.40
Nodes (5): dependencies, @opentui/core, @opentui/solid, solid-js, zod

### Community 21 - "Community 21"
Cohesion: 0.50
Nodes (4): dependencies, @opentui/solid, solid-js, zod

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (3): devDependencies, @types/bun, typescript

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (3): devDependencies, @types/bun, typescript

## Knowledge Gaps
- **167 isolated node(s):** `AgentLoopLimits`, `LimitReached`, `Palette`, `ViewMessage`, `HarnessCapability` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 218 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@opentui/core` connect `Community 10` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Why does `typescript` connect `Community 7` to `Community 10`, `Community 15`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `CatExpression` connect `Community 3` to `Community 0`, `Community 4`, `Community 14`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `App()` (e.g. with `.canAcceptCalls()` and `.getLimitReached()`) actually correct?**
  _`App()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AgentLoopLimits`, `LimitReached`, `Palette` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06080246913580247 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05179982440737489 - nodes in this community are weakly interconnected._