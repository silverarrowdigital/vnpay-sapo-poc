---
description: Stage by path, write the commit message, show it, commit. Never pushes.
---
Run `git status` and `git diff`. Stage only the files that belong to this change, by explicit path. Never use `git add -A` or `git add .` (an unrelated edit once got swept into a commit).

Write the message: an imperative first line, then a short paragraph on WHY, meaning what was measured or decided rather than a list of what changed. End with the Co-Authored-By trailer this session specifies.

Print the full message, then commit and show `git log --oneline -1`. Do NOT push. Say that nothing was pushed, and that pushing to main deploys production, so it needs the user's explicit go-ahead.

$ARGUMENTS
