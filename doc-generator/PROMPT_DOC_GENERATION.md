# Prompt: Documentation Generation & Migration

**Use this prompt with an AI assistant to set up or migrate documentation in any repository.**

---

## 🎯 Purpose

This prompt instructs an AI assistant to either:
1. **Create and populate documentation** for a new module/repository using the Tarek Second Brain documentation structure
2. **Migrate existing documentation** to the standardized documentation model

---

## 📋 Instructions for AI Assistant

You are tasked with setting up or migrating documentation for this repository using the **Tarek Second Brain Documentation Model v3**.

### Step 1: Determine the Scenario

**Check if this is a NEW repository or EXISTING repository:**

- **NEW Repository**: No `doc-repo/` folder exists, minimal or no documentation
- **EXISTING Repository**: Has documentation files (README, doc-repo/, or scattered .md files)

### Step 2: Read the Appropriate Guide

**For NEW repositories:**
1. Read `doc-generator/DOCUMENTATION_MODEL.md` → "Setting Up New Repository" section
2. Follow the step-by-step instructions
3. Use the templates provided to create all core documentation files

**For EXISTING repositories:**
1. Read `doc-generator/DOCUMENTATION_MODEL.md` → "Migrating Existing Repository" section
2. Read `doc-generator/DOCUMENTATION_MODEL.md` for the complete specification
3. Follow the migration steps carefully
4. Preserve existing content by migrating it to the new structure

### Step 3: Reference the Documentation Model

Always refer to `doc-generator/DOCUMENTATION_MODEL.md` for:
- Complete file structure specifications
- Required sections for each file
- Content guidelines and anti-patterns
- Information routing rules

---

## 🚀 Execution Steps

### For NEW Repositories

1. **Create directory structure:**
   ```bash
   mkdir -p doc-repo/daily doc-repo/prompts doc-repo/reference doc-repo/images
   ```

2. **Create core files** using templates from `DOCUMENTATION_MODEL.md`:
   - `doc-repo/tasks.md` - Daily TODO list
   - `doc-repo/knowledge_<reponame>.md` - Primary RAG document (use template from DOCUMENTATION_MODEL.md)
   - `doc-repo/roadmap.md` - Future plans
   - `doc-repo/learning.md` - Research topics
   - `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` - AI maintenance guide
   - `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` - Human maintenance guide

3. **Create/update README.md** in root:
   - Keep it under 100 lines
   - Include quick start only
   - Link to `doc-repo/` for detailed documentation

4. **Populate files** with project-specific information:
   - Analyze the codebase to understand the project
   - Fill knowledge_<reponame>.md with actual project structure, flows, and integrations
   - Add initial tasks to tasks.md
   - Document tech stack in knowledge_<reponame>.md Quick Facts section

### For EXISTING Repositories

1. **Backup current state:**
   ```bash
   git checkout -b backup-before-docs-migration
   git push origin backup-before-docs-migration
   git checkout main
   ```

2. **Create new structure:**
   ```bash
   mkdir -p doc-repo/daily doc-repo/prompts doc-repo/reference doc-repo/archive doc-repo/images
   ```

3. **Identify existing documentation:**
   - Find all .md files in the repository
   - Map them to new locations using the migration guide

4. **Migrate content:**
   - Extract current state from old architecture docs → `doc-repo/knowledge_<reponame>.md`
   - Move TODOs/tasks → `doc-repo/tasks.md`
   - Move roadmap/future plans → `doc-repo/roadmap.md`
   - Move learning topics → `doc-repo/learning.md`
   - Archive old files → `doc-repo/archive/`

5. **Transform knowledge_<reponame>.md:**
   - Use the template from DOCUMENTATION_MODEL.md
   - Focus on **current state only** (remove migration history)
   - Include: Quick Facts, Critical to Know, Project Structure, Key Flows, Common Tasks
   - Remove: Historical changes, migration logs (move to daily logs)

6. **Slim down README.md:**
   - Reduce to 50-100 lines
   - Keep only quick start and links to doc-repo/
   - Move detailed content to appropriate doc-repo/ files

7. **Update cross-references:**
   - Fix all broken links
   - Update paths to point to doc-repo/ structure

---

## ✅ Validation Checklist

After completion, verify:

### Structure
- [ ] `doc-repo/` directory exists with proper subdirectories
- [ ] All core files exist: `tasks.md`, `knowledge_<reponame>.md`, `roadmap.md`, `learning.md`
- [ ] `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` exist
- [ ] `doc-repo/daily/` directory exists
- [ ] `doc-repo/prompts/` directory exists (if applicable)
- [ ] `doc-repo/reference/` directory exists (if applicable)

### Content Quality
- [ ] `README.md` is under 100 lines
- [ ] `doc-repo/knowledge_<reponame>.md` follows template from DOCUMENTATION_MODEL.md
- [ ] `doc-repo/knowledge_<reponame>.md` has Quick Facts section
- [ ] `doc-repo/knowledge_<reponame>.md` has Critical to Know section
- [ ] `doc-repo/knowledge_<reponame>.md` has Common Tasks section
- [ ] `doc-repo/knowledge_<reponame>.md` contains **current state only** (no migration history)
- [ ] `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` exist
- [ ] Old files archived in `doc-repo/archive/` (for migrations)

### Links & References
- [ ] README.md links to doc-repo/ files
- [ ] All cross-references updated
- [ ] No broken links
- [ ] All references use `doc-repo/` (never `docs/`)

---

## 🎯 Key Principles to Follow

1. **Single Source of Truth**: Each piece of information has ONE location
2. **Current State Focus**: knowledge_<reponame>.md describes what IS, not what WAS
3. **AI-Optimized**: Structure and content optimized for AI context and RAG systems
4. **Maintainable**: Clear update rules and regular maintenance schedule
5. **Clean Root**: Only README.md in root, everything else in doc-repo/

---

## 📚 Reference Files

When working on this task, you MUST reference:

- **`doc-generator/DOCUMENTATION_MODEL.md`** - Complete specification, templates, and setup/migration guides
  - "Setting Up New Repository" section for new repos
  - "Migrating Existing Repository" section for existing repos

---

## 🚨 Common Mistakes to Avoid

❌ **Don't:**
- Put migration history in knowledge_<reponame>.md → Move to daily logs
- Keep bloated README → Slim to < 100 lines
- Duplicate information across files → Use single source of truth
- Delete old documentation → Archive it instead
- Use `docs/` as directory name → Always use `doc-repo/`

✅ **Do:**
- Focus knowledge_<reponame>.md on current state + actionable info
- Archive old files (don't delete)
- Update README to link to doc-repo/
- Test all links after migration
- Follow templates exactly from DOCUMENTATION_MODEL.md
- Always use `doc-repo/` as directory name

---

## 💡 Example Usage

**For a new Next.js project:**
```
I need you to set up documentation for this Next.js project. 
Read doc-generator/PROMPT_DOC_GENERATION.md and follow the instructions 
for a NEW repository. The project is a customer portal built with 
Next.js 14, TypeScript, and Tailwind CSS.
```

**For an existing repository:**
```
I need you to migrate the existing documentation in this repository. 
Read doc-generator/PROMPT_DOC_GENERATION.md and follow the instructions 
for an EXISTING repository. The current documentation is scattered 
across multiple .md files in the root and a doc-repo/ folder.
```

---

## 📝 Notes

- This prompt is designed to be **copied and pasted directly** to an AI assistant
- The AI should read the referenced guides before starting work
- All templates and examples are in DOCUMENTATION_MODEL.md
- The AI should analyze the codebase to populate knowledge_<reponame>.md accurately
- For migrations, preserve all existing content by moving it to appropriate locations
- After setup, point users to `doc-repo/AI_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` and `doc-repo/HUMAN_DOCUMENTATION_MAINTENANCE_WORKFLOW.md` for maintenance

---

**Ready to use! Copy this entire prompt and paste it to your AI assistant along with the task description.**
