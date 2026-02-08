# Tarek Second Brain - Documentation Model v3

## Overview

A standardized, AI-optimized documentation structure for all repositories. Clean, focused, and maintainable.

## Core Principles

1. **Clarity**: Obvious file names, clear purposes
2. **AI-First**: Optimized for AI context and RAG systems
3. **Single Source**: Each piece of information has ONE location
4. **Maintenance**: Easy to keep up-to-date

---

## File Structure

```
repo-root/
├── README.md                    # Public overview only
└── doc-repo/
    ├── knowledge_<reponame>.md  # Primary RAG document (technical context)
    ├── roadmap.md              # Long-term plans
    ├── tasks.md                # Active TODOs & bugs
    ├── learning.md             # Topics to learn
    ├── AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md  # AI maintenance guide
    ├── HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md  # Human maintenance guide
    ├── daily/
    │   └── YYYY-MM-DD.md       # Daily logs
    ├── prompts/
    │   └── *.md                # Reusable prompts
    └── reference/
        └── *.md                # Reference documents
```

**Important Notes**:
- ✅ Always use `doc-repo/` as the directory name, never `docs/`
- ✅ Primary RAG document should be named `knowledge_<reponame>.md` (e.g., `knowledge_demo-customer-portal.md`). `architecture.md` is acceptable but not preferred.
- ✅ All docs in `doc-repo/` folder (cleaner root)
- ✅ Clear names: `knowledge_<reponame>.md`, `roadmap.md`, `tasks.md`, `learning.md`
- ✅ Workflow files replace old FOR_AI.md and FOR_HUMANS.md

---

## File Definitions

### 1. `README.md` (Root - Public Overview)

**Purpose**: Public-facing quick start guide  
**Location**: Repository root  
**Length**: 50-100 lines max

**Required Sections**:
```markdown
# Project Name

One-line description

## Quick Start

```bash
# Install
npm install

# Run
npm run dev

# Test
npm test
```

## Documentation

See [`doc-repo/`](doc-repo/) for complete documentation:
- **Architecture**: `doc-repo/knowledge_<reponame>.md`
- **Roadmap**: `doc-repo/roadmap.md`
- **Tasks**: `doc-repo/tasks.md`

## Tech Stack

- Framework: Next.js 14
- Language: TypeScript
- ...
```

**What to include**:
- Project name and description
- Installation and run commands
- Link to docs folder
- High-level tech stack

**What NOT to include**:
- Architecture details (→ `doc-repo/knowledge_<reponame>.md`)
- Active bugs (→ `doc-repo/tasks.md`)
- Future plans (→ `doc-repo/roadmap.md`)

---

### 2. `doc-repo/knowledge_<reponame>.md` (Primary RAG Document)

**Purpose**: Primary RAG document - complete technical context for AI agents and deep reference  
**Audience**: AI, yourself (context refresh)  
**Focus**: Current state, actionable info, zero fluff  
**Naming**: Should be `knowledge_<reponame>.md` (e.g., `knowledge_demo-customer-portal.md`). `architecture.md` is acceptable but not preferred.

**Required Structure**:

```markdown
# Architecture - <Project Name>

> **AI Context**: This is a <Next.js/Python/etc> project for <purpose>.

## Quick Facts

- **Type**: <Web App / API / CLI / Library>
- **Stack**: <Framework, Language, Database>
- **Deployment**: <Where and how it's deployed>
- **Last Updated**: YYYY-MM-DD

## What This Project Does

<2-3 sentences explaining the core purpose>

## Critical to Know

### 🚨 Constraints
- Constraint 1 (why it exists)
- Constraint 2 (why it exists)

### 🏗️ Architecture Decisions
- Decision 1: Rationale
- Decision 2: Rationale

### ⚠️ Gotchas
- Thing that will trip you up 1
- Thing that will trip you up 2

## Project Structure

```
src/
├── component-type-1/    # What it contains
├── component-type-2/    # What it contains
└── utilities/           # What it contains
```

**Key directories**:
- `src/app/`: <Purpose and patterns>
- `src/components/`: <Organization logic>
- `src/lib/`: <What utilities exist>

## Key Flows

### Flow 1: <Name> (e.g., Authentication)
1. Step 1 happens
2. Step 2 happens
3. Result

### Flow 2: <Name> (e.g., Data Loading)
1. Step 1
2. Step 2
3. Result

## Integration Points

### External Service 1
- **Purpose**: What it does
- **Config**: Where env vars are
- **Docs**: Link to external docs

### External Service 2
- **Purpose**: What it does
- **Config**: Where env vars are
- **Docs**: Link to external docs

## Common Tasks

### Adding a new feature
1. Create component in `src/components/<type>/`
2. Update relevant flow
3. Add tests

### Debugging X
- Check Y first
- Look at Z logs
- Common issue: ...

## AI Usage Guide

**Best prompts to use**:
- "You are an expert <tech> developer working on <project type>"
- "Context: This is <unique aspect of project>"

**Example queries this doc answers**:
- How does authentication work?
- Where do I add a new component?
- What external services are integrated?

## Known Gaps

- [ ] Gap 1
- [ ] Gap 2
```

**Key Improvements**:
- ✅ **Quick Facts** section at top (immediate context)
- ✅ **Critical to Know** section (constraints, decisions, gotchas)
- ✅ **Common Tasks** section (actionable guidance)
- ✅ **No migration history** (that goes in daily logs)
- ✅ **Focus on "what you need to know"** not "what happened"

**Update when**:
- Architecture changes
- New integrations added
- Important decisions made
- New constraints discovered

---

### 3. `doc-repo/roadmap.md` (Long-term Plans)

**Purpose**: Future vision and planned features  
**Length**: Variable

**Structure**:
```markdown
# Roadmap

## Current Focus

<What you're working on right now - 1-2 sentences>

## Planned

### Phase 1: <Name>
- [ ] Feature 1
- [ ] Feature 2

### Phase 2: <Name>
- [ ] Feature 3
- [ ] Feature 4

## Ideas / Wishlist

- Idea 1
- Idea 2

## Not Planned

- Thing we explicitly won't do (and why)
```

**Update when**:
- Planning new features
- Completing phases
- Deprioritizing ideas

---

### 4. `doc-repo/tasks.md` (Active Work)

**Purpose**: What needs to be done now  
**Length**: Keep it clean, archive old items

**Structure**:
```markdown
# Tasks

## Critical Bugs 🚨

- [ ] Bug 1 - Description
- [ ] Bug 2 - Description

## This Week

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Backlog

- [ ] Task 4
- [ ] Task 5

## Blocked

- [ ] Task 6 - Waiting on X

## Recently Completed ✅

- [x] Task 7 (2025-11-27)
- [x] Task 8 (2025-11-26)

> Archive completed items to daily logs after 1 week
```

**Update when**:
- Starting new task
- Completing task
- Discovering bug
- Blocking/unblocking work

---

### 5. `doc-repo/learning.md` (Learning & Research)

**Purpose**: Topics to learn and lessons from experience  

**Structure**:
```markdown
# Learning

## To Learn 📚

### Technology 1
- **Why**: Reason you need to learn this
- **Priority**: High/Medium/Low
- **Resources**: Links to docs, tutorials

### Technology 2
- **Why**: ...
- **Priority**: ...
- **Resources**: ...

## Lessons Learned 🧠

### Topic: <Name>
**Date**: YYYY-MM-DD

**Challenge**: What problem you faced

**What Didn't Work**:
- Approach 1: Why it failed
- Approach 2: Why it failed

**What Worked**:
- Solution: Why it worked

**Key Takeaway**: One-line lesson

## Open Questions ❓

- Question 1
- Question 2
```

**Update when**:
- Discovering knowledge gap
- Solving difficult problem
- Learning new approach

---

### 6. `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` & `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`

**Purpose**: Complete maintenance workflow guides for different audiences.

**`AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`**: 
- When to update each file
- How to update each file (format, sections, what to include/exclude)
- Maintenance schedule (daily, per PR, weekly, monthly)
- Writing style guidelines
- Common mistakes
- File responsibilities quick reference
- Decision trees inline

**`HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`**:
- Simple daily workflow
- Quick answers to common questions
- When to update each file
- Maintenance schedule
- Writing style guidelines
- File responsibilities quick reference

---

### 8. `doc-repo/daily/YYYY-MM-DD.md` (Daily Logs)

**Purpose**: Chronological work record

**Structure**:
```markdown
# 2025-11-27

## Completed
- [x] Task 1
    - Result: What happened
    - Notes: Important details

## In Progress
- [ ] Task 2
    - Status: Where you left off

## Decisions
- Decision 1: Rationale

## Discoveries
- Discovery 1: What you learned

## Blockers
- Blocker 1: What's preventing progress

## Tomorrow
- [ ] Next task
```

**Update when**:
- End of work session
- Making important decision
- Significant discovery

---

---

### 9. `doc-repo/prompts/` Directory

**Purpose**: Reusable AI prompts

**Files**:
- `feature.md` - For implementing features
- `refactor.md` - For refactoring code
- `debug.md` - For debugging issues
- `knowledge_<reponame>.md` - For architecture questions

**Structure**:
```markdown
# Prompt: <Name>

## Context
<Project-specific context to set>

## Task
<What you want AI to do>

## Constraints
- Constraint 1
- Constraint 2

## Example Usage
"<Full prompt example>"

## Gotchas
- Common mistake 1
- Common mistake 2
```

---

---

---

## Setting Up New Repository

This section provides step-by-step instructions for setting up documentation in a brand new repository.

### Step 1: Create Directory Structure

```bash
# In your new repo root
mkdir -p doc-repo/daily doc-repo/prompts doc-repo/reference doc-repo/images
```

### Step 2: Create Core Documentation Files

Create these essential files in `doc-repo/`:

#### 1. `doc-repo/tasks.md`
```markdown
# Tasks

## Critical Bugs 🚨

_None currently_

## This Week

- [ ] Your first task here

## Backlog

- [ ] Future tasks

## Recently Completed ✅

- [x] Initial setup (YYYY-MM-DD)
```

#### 2. `doc-repo/knowledge_<reponame>.md`
Use the template from the "File Definitions" section above. Fill in:
- Quick Facts (type, stack, deployment)
- What This Project Does
- Critical to Know (constraints, decisions, gotchas)
- Project Structure
- Key Flows
- Integration Points
- Common Tasks
- AI Usage Guide
- Known Gaps

#### 3. `doc-repo/roadmap.md`
```markdown
# Roadmap

## Current Focus

[What you're working on right now]

## Planned

### Phase 1: [Name]
- [ ] Feature 1
- [ ] Feature 2

## Ideas / Wishlist

- Idea 1
- Idea 2
```

#### 4. `doc-repo/learning.md`
```markdown
# Learning

## To Learn 📚

### Technology 1
- **Why**: Reason
- **Priority**: High/Medium/Low
- **Resources**: [Links]

## Lessons Learned 🧠

### Topic: [Name]
**Date**: YYYY-MM-DD

**Challenge**: Problem faced
**What Didn't Work**: Approach 1
**What Worked**: Solution
**Key Takeaway**: Lesson

## Open Questions ❓

- Question 1
```

#### 5. `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` & `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`
Copy these workflow files from an existing repository or create them using the templates in the workflow files section.

### Step 3: Create README

In repository root, create `README.md`:

```markdown
# [Project Name]

[One-line description]

## Quick Start

```bash
# Install
[install command]

# Run
[run command]

# Test
[test command]
```

## Documentation

See [`doc-repo/`](doc-repo/) for complete documentation:
- **[Architecture](doc-repo/knowledge_<reponame>.md)** - How it works
- **[Tasks](doc-repo/tasks.md)** - Current work
- **[Roadmap](doc-repo/roadmap.md)** - Future plans

## Tech Stack

- Framework: [Name]
- Language: [Name]
- [Other key technologies]
```

### Step 4: Create First Daily Log

```bash
# Create today's log
touch doc-repo/daily/$(date +%Y-%m-%d).md
```

Edit `doc-repo/daily/YYYY-MM-DD.md`:
```markdown
# YYYY-MM-DD

## Completed
- [x] Set up documentation structure

## Notes
- Initial repository setup

## Tomorrow
- [ ] [Next task]
```

### Validation Checklist

After setup, verify you have:

- [ ] `doc-repo/tasks.md` - Your TODO list
- [ ] `doc-repo/knowledge_<reponame>.md` - Technical context (primary RAG document)
- [ ] `doc-repo/roadmap.md` - Future plans
- [ ] `doc-repo/learning.md` - Research topics
- [ ] `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` - AI maintenance guide
- [ ] `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` - Human maintenance guide
- [ ] `doc-repo/daily/` folder - Daily logs
- [ ] `README.md` in root - Public overview
- [ ] All templates filled with your project info

---

## Migrating Existing Repository

This section provides step-by-step instructions for migrating an existing repository to this documentation structure.

### Step 1: Backup Current State

```bash
# Create a backup branch
git checkout -b backup-before-docs-migration
git push origin backup-before-docs-migration

# Return to main
git checkout main
```

### Step 2: Create New Structure

```bash
# Create new directories
mkdir -p doc-repo/daily doc-repo/prompts doc-repo/reference doc-repo/archive doc-repo/images
```

### Step 3: Identify Current Documentation

Find all existing documentation:

```bash
# List all markdown files
find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*"
```

Common names to look for:
- `TODO.md`, `TODOS.md` → Will become `doc-repo/tasks.md`
- `ROADMAP.md`, `FUTURE.md` → Will become `doc-repo/roadmap.md`
- `ARCHITECTURE.md`, `TECH.md` → Will become `doc-repo/knowledge_<reponame>.md`
- `CONTRIBUTING.md` → Content may go to workflow files
- Scattered notes → Archive or migrate content

### Step 4: Migrate Content

#### 4.1: Create `doc-repo/tasks.md`

Combine content from:
- Existing TODO files
- Open issues you're tracking
- Bug lists

#### 4.2: Create `doc-repo/knowledge_<reponame>.md`

Transform existing architecture docs:

**Old style** (what to extract):
```markdown
# Project Architecture

## Overview
This project uses [tech stack].

## History
We migrated from X to Y in 2023...
[Move this to doc-repo/daily/ or archive]

## How it works
[Keep this]
```

**New style** (focused template):
Use the template from "File Definitions" section. Focus on:
- Quick Facts section (type, stack, deployment)
- Critical to Know (constraints, decisions, gotchas)
- Common Tasks (actionable guidance)
- Zero migration history
- Current state only

**Important**: Move migration history to archive, keep only current state.

#### 4.3: Create `doc-repo/roadmap.md`

Extract from old ROADMAP.md or issues.

#### 4.4: Create `doc-repo/learning.md`

Extract learning topics from old files.

#### 4.5: Create Workflow Files

Copy `AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` from an existing repository or create them using templates.

### Step 5: Archive Old Documentation

```bash
# Move old docs to archive
mv OLD_README.md doc-repo/archive/ 2>/dev/null || true
mv ARCHITECTURE_OLD.md doc-repo/archive/ 2>/dev/null || true
mv TODO.md doc-repo/archive/ 2>/dev/null || true
# etc.
```

### Step 6: Update README

Slim down your README to 50-100 lines max:

**Before** (typical bloated README):
```markdown
# Project

[Long description...]

## Architecture
[Huge section - 200 lines]

## Contributing
[Another huge section]

## Roadmap
[More content]
```

**After** (clean README):
```markdown
# [Project Name]

[One-line description]

## Quick Start

```bash
# Install & Run
[Commands]
```

## Documentation

See [`doc-repo/`](doc-repo/) for complete documentation:
- **[Architecture](doc-repo/knowledge_<reponame>.md)** - How it works
- **[Tasks](doc-repo/tasks.md)** - Current work
- **[Roadmap](doc-repo/roadmap.md)** - Future plans

## Tech Stack
[Brief list]
```

Move detailed content to appropriate doc-repo files.

### Step 7: Migrate Daily Notes (if any)

If you have existing notes/logs:

```bash
# Move to new location
mv notes/2025-11-*.md doc-repo/daily/ 2>/dev/null || true
# or
cp journal/*.md doc-repo/daily/ 2>/dev/null || true
```

Standardize format using the daily log template.

### Step 8: Update Cross-References

Search for broken links:

```bash
# Find all markdown links
grep -r "\[.*\](.*\.md)" --include="*.md" .
```

Update links to point to new locations:
- `[Architecture](ARCHITECTURE.md)` → `[Architecture](doc-repo/knowledge_<reponame>.md)`
- `[TODO](TODO.md)` → `[Tasks](doc-repo/tasks.md)`

### Step 9: Validation

```bash
# Check structure
tree doc-repo/ -L 2

# Verify core files exist
ls doc-repo/tasks.md doc-repo/knowledge_<reponame>.md doc-repo/roadmap.md doc-repo/learning.md

# Check README size (should be under 100 lines)
wc -l README.md
```

### Checklist

- [ ] `doc-repo/tasks.md` created with content
- [ ] `doc-repo/knowledge_<reponame>.md` created (no migration history)
- [ ] `doc-repo/roadmap.md` created
- [ ] `doc-repo/learning.md` created
- [ ] `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` created
- [ ] Old files moved to `doc-repo/archive/`
- [ ] README updated (< 100 lines)
- [ ] Cross-references updated
- [ ] Tested links work

### Step 10: Commit & Push

```bash
# Stage changes
git add -A

# Commit
git commit -m "docs: migrate to new documentation structure

- Created doc-repo/ folder with core files
- Migrated content from old documentation
- Archived old files in doc-repo/archive/
- Slimmed README to quick start only
- Updated all cross-references"

# Push
git push origin main
```

### Content Migration Map

| Old File | New Location | Notes |
|----------|--------------|-------|
| `TODO.md` | `doc-repo/tasks.md` | Migrate tasks |
| `ROADMAP.md` | `doc-repo/roadmap.md` | Migrate plans |
| `ARCHITECTURE.md` | `doc-repo/knowledge_<reponame>.md` | Extract current state only |
| `CONTRIBUTING.md` | `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` | Adapt to new format |
| Migration logs | `doc-repo/archive/` | Archive, don't migrate |
| Setup guides | `README.md` | Keep brief version |
| Detailed setup | `doc-repo/knowledge_<reponame>.md` | Move complex details |

### Common Pitfalls

#### ❌ Don't:
- Put migration history in `knowledge_<reponame>.md` → Use `doc-repo/daily/` or archive
- Keep bloated README → Slim to < 100 lines
- Lose old docs → Move to `doc-repo/archive/`
- Leave broken links → Update all references
- Skip validation → Always check structure

#### ✅ Do:
- Focus on current state in `knowledge_<reponame>.md`
- Archive old files (don't delete)
- Update README to link to `doc-repo/`
- Test all links after migration
- Commit in logical chunks

### After Migration

#### Immediate (First Week)
1. Read `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`
2. Start using `doc-repo/tasks.md` daily
3. Update `doc-repo/knowledge_<reponame>.md` as you discover gaps

#### Ongoing
1. Log work in `doc-repo/daily/YYYY-MM-DD.md`
2. Keep `doc-repo/knowledge_<reponame>.md` current (remove outdated info)
3. Archive daily logs older than 1 month

---

## Information Routing

| What | Where |
|------|-------|
| Active bug | `doc-repo/tasks.md` |
| Future feature idea | `doc-repo/roadmap.md` |
| How architecture works | `doc-repo/knowledge_<reponame>.md` |
| Quick start instructions | `README.md` |
| What I did today | `doc-repo/daily/YYYY-MM-DD.md` |
| Topic to research | `doc-repo/learning.md` |
| Important decision | `doc-repo/daily/YYYY-MM-DD.md` + `doc-repo/knowledge_<reponame>.md` if architectural |
| External integration | `doc-repo/knowledge_<reponame>.md` under "Integration Points" |
| Common task steps | `doc-repo/knowledge_<reponame>.md` under "Common Tasks" |

---

## Documentation Update Rules

### When to Update

Update documentation **in the same PR** when:

1. **Architecture changes**: Components, flows, integrations
2. **New features**: Add to knowledge_<reponame>.md common tasks if applicable
3. **Important decisions**: Document in daily log + knowledge_<reponame>.md
4. **Bugs discovered**: Add to tasks.md
5. **Future ideas**: Add to roadmap.md
6. **Learning moments**: Add to learning.md

### How to Update

**Daily**:
- [ ] Update `doc-repo/daily/YYYY-MM-DD.md` at end of session
- [ ] Check off tasks in `doc-repo/tasks.md`

**Per PR**:
- [ ] Update `doc-repo/knowledge_<reponame>.md` if architecture changed
- [ ] Update `README.md` if setup changed

**Weekly**:
- [ ] Move completed tasks from `doc-repo/tasks.md` to daily logs
- [ ] Review `doc-repo/roadmap.md` for progress

**Monthly**:
- [ ] Archive old daily logs
- [ ] Review `doc-repo/learning.md` for completed items

---

## Migration Checklist

To apply this model to an existing repo:

- [ ] Create `doc-repo/` directory structure
- [ ] Move/create files with new names:
  - [ ] `README.md` → Slim down, keep in root
  - [ ] RAG/architecture doc → `doc-repo/knowledge_<reponame>.md` (use new template)
  - [ ] `next_long_term.md` → `doc-repo/roadmap.md`
  - [ ] `next_day_after.md` → `doc-repo/tasks.md`
  - [ ] `learn_next.md` → `doc-repo/learning.md`
  - [ ] Daily logs → `doc-repo/daily/`
  - [ ] Prompts → `doc-repo/prompts/`
- [ ] Create `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md`
- [ ] Update all cross-references
- [ ] Remove old documentation files
- [ ] Update `.gitignore` if needed

---

## Anti-Patterns

❌ **Don't**:
- Put detailed architecture in README
- Put migration history in knowledge_<reponame>.md
- Put future ideas in knowledge_<reponame>.md
- Duplicate information across files
- Let tasks.md grow infinitely (archive to daily logs)
- Use `docs/` as directory name (always use `doc-repo/`)

✅ **Do**:
- Keep README under 100 lines
- Focus knowledge_<reponame>.md on current state + actionable info
- Use single source of truth
- Archive old daily logs
- Update docs in same PR as code
- Always use `doc-repo/` as directory name

---

## Benefits of This Model

1. **Cleaner Root**: Only README visible in root directory
2. **Obvious Names**: No more "next_day_after" confusion
3. **AI-Optimized**: knowledge_<reponame>.md structured for perfect AI context and RAG systems
4. **Maintainable**: Clear update rules and regular maintenance schedule with workflow files
5. **Scalable**: Works for small projects and large codebases
6. **Consistent**: Always use `doc-repo/` directory name across all repositories

---

**Version**: 3.0  
**Last Updated**: 2025-11-27  
**Owner**: Tarek
