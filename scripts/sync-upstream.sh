#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  pnpm run sync:upstream
  pnpm run sync:upstream -- --finish [--push]

The default command fetches origin/master, creates a backup of local main, and
merges upstream into a new codex/upstream-sync-* branch. Resolve any conflicts
and commit the merge on that branch, then run --finish to build and fast-forward
local main. Add --push to publish the verified main to jingwork-ds/main.
EOF
}

fail() {
  printf 'sync:upstream: %s\n' "$1" >&2
  exit 1
}

mode=prepare
push_after_finish=false
while (($#)); do
  case "$1" in
    --)
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --finish)
      mode=finish
      ;;
    --push)
      push_after_finish=true
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
  shift
done

if [[ "$push_after_finish" == true && "$mode" != finish ]]; then
  fail '--push is valid only with --finish'
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail 'run this command inside the repository'
cd "$repo_root"

origin_url=$(git remote get-url origin 2>/dev/null) || fail 'remote origin is missing'
normalized_origin=${origin_url#https://github.com/}
normalized_origin=${normalized_origin#http://github.com/}
normalized_origin=${normalized_origin#ssh://git@github.com/}
normalized_origin=${normalized_origin#git@github.com:}
normalized_origin=${normalized_origin%.git}
[[ "$normalized_origin" == deepseek-ai/deepseek-harness ]] \
  || fail "origin must be deepseek-ai/deepseek-harness; found $origin_url"

fork_url=$(git remote get-url jingwork-ds 2>/dev/null) || fail 'remote jingwork-ds is missing'
normalized_fork=${fork_url#https://github.com/}
normalized_fork=${normalized_fork#http://github.com/}
normalized_fork=${normalized_fork#ssh://git@github.com/}
normalized_fork=${normalized_fork#git@github.com:}
normalized_fork=${normalized_fork%.git}
[[ "$normalized_fork" != "$normalized_origin" ]] \
  || fail 'jingwork-ds must point to your fork, not the official repository'

git show-ref --verify --quiet refs/heads/main || fail 'local main branch is missing'
main_upstream=$(git for-each-ref --format='%(upstream:short)' refs/heads/main)
[[ "$main_upstream" == jingwork-ds/main ]] \
  || fail "local main must track jingwork-ds/main; found ${main_upstream:-no upstream}"

git fetch origin master:refs/remotes/origin/master
git show-ref --verify --quiet refs/remotes/origin/master || fail 'origin/master is missing after fetch'

if [[ "$mode" == prepare ]]; then
  current_branch=$(git branch --show-current)
  [[ "$current_branch" == main ]] || fail "start from main; current branch is $current_branch"
  [[ -z "$(git status --porcelain)" ]] || fail 'working tree must be clean before preparing an upstream merge'

  read -r upstream_only local_only <<<"$(git rev-list --left-right --count origin/master...main)"
  printf 'Commits only in origin/master: %s; commits only in main: %s.\n' "$upstream_only" "$local_only"

  if git merge-base --is-ancestor origin/master main; then
    printf 'Local main already contains origin/master; no merge is needed.\n'
    exit 0
  fi

  stamp=$(date '+%Y%m%d-%H%M%S')
  backup_branch="backup/main-before-upstream-$stamp"
  sync_branch="codex/upstream-sync-$stamp"
  git show-ref --verify --quiet "refs/heads/$backup_branch" && fail "backup branch already exists: $backup_branch"
  git show-ref --verify --quiet "refs/heads/$sync_branch" && fail "sync branch already exists: $sync_branch"

  git branch "$backup_branch" main
  git switch --create "$sync_branch" main
  if git merge --no-ff --no-edit origin/master; then
    printf '\nUpstream merge is ready on %s. Review the changes and run relevant checks.\n' "$sync_branch"
    printf 'Then run: pnpm run sync:upstream -- --finish\n'
    printf 'To also push the verified result: pnpm run sync:upstream -- --finish --push\n'
    printf 'Backup retained at: %s\n' "$backup_branch"
    exit 0
  fi

  if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
    conflict_count=$(git diff --name-only --diff-filter=U | awk 'END { print NR + 0 }')
    printf '\n%d paths conflict on %s. Resolve them, commit the merge, then run --finish.\n' \
      "$conflict_count" "$sync_branch" >&2
    printf 'To abandon the merge, run: git merge --abort\n' >&2
  else
    printf '\nThe merge stopped with an error on %s. Inspect git status before continuing.\n' "$sync_branch" >&2
  fi
  exit 1
fi

current_branch=$(git branch --show-current)
[[ "$current_branch" =~ ^codex/upstream-sync-([0-9]{8}-[0-9]{6})$ ]] \
  || fail "--finish must run on a codex/upstream-sync-* branch; current branch is ${current_branch:-detached HEAD}"
stamp=${BASH_REMATCH[1]}
backup_branch="backup/main-before-upstream-$stamp"
git show-ref --verify --quiet "refs/heads/$backup_branch" || fail "expected backup branch is missing: $backup_branch"
[[ -z "$(git status --porcelain)" ]] || fail 'working tree must be clean before finishing the merge'
git rev-parse --verify -q MERGE_HEAD >/dev/null && fail 'finish the in-progress merge commit before running --finish'

git merge-base --is-ancestor "$backup_branch" HEAD \
  || fail "sync branch no longer descends from $backup_branch"
git merge-base --is-ancestor origin/master HEAD \
  || fail 'origin/master advanced after preparation; merge the latest origin/master before finishing'
merge_count=$(git rev-list --count --merges "$backup_branch..HEAD")
((merge_count > 0)) || fail 'sync branch has no upstream merge commit'
[[ "$(git rev-parse main)" == "$(git rev-parse "$backup_branch")" ]] \
  || fail "main moved after preparation; preserve the sync branch and review the new main before finishing"

command -v pnpm >/dev/null 2>&1 || fail 'pnpm is required to build the merged source'
pnpm run build

git switch main
git merge --ff-only "$current_branch"
printf '\nLocal main now contains upstream changes at %s.\n' "$(git rev-parse --short HEAD)"

if [[ "$push_after_finish" == true ]]; then
  git push jingwork-ds main
  git fetch jingwork-ds main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse jingwork-ds/main)" ]] \
    || fail 'push completed, but jingwork-ds/main does not match local main'
  printf 'Verified jingwork-ds/main at %s.\n' "$(git rev-parse --short HEAD)"
else
  printf 'To publish this update later, run: git push jingwork-ds main\n'
fi
