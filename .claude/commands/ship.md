---
description: Commit current changes on a feature branch, open a PR, wait for CI, and merge once green
argument-hint: "[short description of what's being shipped]"
---

Ship the current working-tree changes end-to-end, following the Git Workflow section in CLAUDE.md (feature branch + PR, never commit to `main`, Conventional Commits). `$ARGUMENTS` may describe what's being shipped or which files belong to this change — use it to scope the diff if given.

Steps:

1. **Scope the diff.** Run `git status --short` and `git diff`. If the working tree mixes unrelated changes (e.g. a pending doc edit alongside an unrelated fix), stage only the files that form one logical change. If it's ambiguous which files belong together, ask before staging — don't sweep in unrelated changes.

2. **Branch.** If currently on `main`, create a branch named `<type>/<short-description>`, where `<type>` is inferred from the diff (`feat`/`fix`/`docs`/`chore`/`refactor`/`test`/`perf`). If already on a non-main branch with matching in-progress work, reuse it instead of branching again.

3. **Verify before shipping.** Run `npm run type-check`, `npm test`, and `npm run lint` (or invoke `/test`). If a failure is caused by this change, fix it before proceeding — don't ship broken code. If a failure is pre-existing and unrelated to this diff, note it plainly in the PR body rather than hiding it.

4. **Commit.** Stage the scoped files and commit with a Conventional Commits message: `<type>(<optional scope>): <summary>`, plus a short body explaining *why* the change was made. Never use `--no-verify` or `--amend` on existing history.

5. **Push + PR.** Push the branch (`-u` on first push) and open a PR with `gh pr create`, including a short Summary (bullets) and a Test plan checklist reflecting what step 3 actually verified (check off what passed, leave unchecked anything not run).

6. **Wait for CI.** Poll `gh pr checks <number>` until every check leaves the `pending` state. Use the Monitor tool with a polling loop (or a Bash `run_in_background` wait) — do not chain manual `sleep` calls.

7. **Merge.** If all checks pass, merge with `gh pr merge --squash --delete-branch`. If any check fails, stop and report which check failed and why — do not merge on red CI without the user explicitly telling you to proceed anyway.

8. **Sync.** After merging, switch back to `main`, `git pull`, and run `git fetch --prune` to clear the deleted remote branch.

Finish with a short report: branch name, PR URL, final CI status per check, and merge result. Keep it to a few lines — no step-by-step narration of things that went as expected.
