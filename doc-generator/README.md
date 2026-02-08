# Documentation Generator

**Reusable templates and guides for setting up documentation in any repository.**

---

## 🎯 Purpose

This folder contains everything you need to set up the "Tarek Second Brain" documentation structure in **any project**, whether new or existing.

**Copy this entire folder** to use in other repositories!

---

## 📋 What's Inside

### **For New Repositories**

**`DOCUMENTATION_MODEL.md`** → "Setting Up New Repository" section ⭐
- Complete guide for brand new projects
- Step-by-step instructions (5-10 minutes)
- Templates for all core documentation files
- Creates: `doc-repo/tasks.md`, `doc-repo/knowledge_<reponame>.md`, etc.

**Use when**: Starting a new repository from scratch.

---

### **For Existing Repositories**

**`DOCUMENTATION_MODEL.md`** → "Migrating Existing Repository" section ⭐
- Migration guide for existing projects
- Step-by-step process (30-60 minutes)
- Content migration map (old → new)
- Validation checklist

**Use when**: Improving documentation in an existing repository.

---

### **Reference**

**`DOCUMENTATION_MODEL.md`**
- The complete standard specification
- Detailed explanations
- Reference when you need details

---

### **For AI Assistants** 🤖

**`PROMPT_DOC_GENERATION.md`** ⭐ **NEW!**
- Ready-to-use prompt for AI assistants
- Copy and paste directly to your AI
- Handles both new and existing repositories
- Includes validation checklist
- References all necessary guides automatically

**Use when**: You want an AI assistant to set up or migrate documentation automatically.

---

## 🚀 How to Use

### Option 1: Copy Entire Folder
```bash
# Copy to a new repo
cp -r doc-generator/ /path/to/other-repo/

# Follow the appropriate guide
cd /path/to/other-repo
cat doc-generator/DOCUMENTATION_MODEL.md  # See "Setting Up New Repository" or "Migrating Existing Repository" sections
```

> **Note**: By default, GitHub repositories are cloned to `/Users/tayadi/Github`. If you are working on a different machine, adjust paths accordingly.

### Option 2: Copy Individual Files
```bash
# For a new or existing repo
cp doc-generator/DOCUMENTATION_MODEL.md /path/to/repo/
cd /path/to/repo
# Follow the appropriate section in DOCUMENTATION_MODEL.md
```

---

## 📁 Resulting Structure

After using these guides, your repository will have:

```
your-repo/
├── README.md                   # Public quick start
└── doc-repo/
    ├── tasks.md                # Daily TODO list
    ├── knowledge_<reponame>.md # Primary RAG document
    ├── roadmap.md              # Future plans
    ├── learning.md             # Research topics
    ├── AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md  # AI maintenance guide
    ├── HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md  # Human maintenance guide
    ├── daily/                  # Daily logs
    ├── prompts/                # AI prompts
    └── reference/              # Reference documents
```

---

## ✅ Quick Decision

**"I'm starting a NEW project"**
→ Use `DOCUMENTATION_MODEL.md` → "Setting Up New Repository" section

**"I have an EXISTING project with messy docs"**
→ Use `DOCUMENTATION_MODEL.md` → "Migrating Existing Repository" section

**"I need to understand the standard"**
→ Read `DOCUMENTATION_MODEL.md`

---

## 💡 Pro Tip

Create a script to automate:

```bash
#!/bin/bash
# setup-docs.sh

# Copy doc generator to new repo
cp -r ~/templates/doc-generator .

# Follow setup guide
cat doc-generator/SETUP_NEW_REPO.md
```

---
## 🎯 Keep Root Clean

The root should only contain:

- ✅ `README.md` - Public overview

- ✅ doc-repo for repository documentation (always use `doc-repo/`, never `docs/`)

- ✅ doc-generator only for one-time setup or migration. Or updating the doc-generator itself, it needs to be precise, intentional, and replicated in all repos.

- ❌ Daily work docs → Use `doc-repo/` instead

- ❌ Old documentation → Move to `archive/`

---
## 🎯 What Makes This Special

### Reusable
- Copy once, use everywhere
- No project-specific content in templates
- Works for any tech stack

### Complete
- All templates provided
- Step-by-step instructions
- Validation checklists

### Proven
- Battle-tested on real projects
- Evolves with use
- AI-optimized structure

---

## 📝 For AI Code Assistants

**Recommended**: Use `PROMPT_DOC_GENERATION.md` - it's a complete, ready-to-use prompt that handles everything automatically.

**Alternative manual approach**:
When an AI is setting up a new repo manually, they should:

1. Read `DOCUMENTATION_MODEL.md` → "Setting Up New Repository" or "Migrating Existing Repository"
2. Create the directory structure
3. Fill templates with project-specific info
4. Validate with checklist

**Quick AI Prompt** (if not using PROMPT_DOC_GENERATION.md):
```
Read doc-generator/PROMPT_DOC_GENERATION.md and follow the instructions 
for this [new/existing] repository.
```

**After Setup**: Point users to `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` for maintenance.

---

## 🔄 Keeping Up to Date

This folder should be:
- ✅ Copied to new repos
- ✅ Updated when standard improves
- ✅ Generic (no project-specific content)
- ❌ Not modified per-project (use in other repos as-is)

---

**This is your documentation starter kit for all future projects!**
