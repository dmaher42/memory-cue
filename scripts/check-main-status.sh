#!/usr/bin/env bash

# Branch Status Checker
# This script checks if the main branch is up to date with the remote

set -e

echo "==================================="
echo "Main Branch Status Checker"
echo "==================================="
echo ""

# Fetch the latest from origin
echo "Fetching latest changes from remote..."
git fetch origin main --quiet

# Get commit hashes
MAIN_TRACKING=$(git rev-parse origin/main 2>/dev/null || echo "not found")
MAIN_REMOTE_HASH=$(git ls-remote origin refs/heads/main | cut -f1)

echo "Local tracking branch (origin/main): $MAIN_TRACKING"
echo "Remote main branch hash:             $MAIN_REMOTE_HASH"
echo ""

# Compare
if [ "$MAIN_TRACKING" = "$MAIN_REMOTE_HASH" ]; then
    echo "✅ STATUS: Main branch is UP TO DATE"
    echo ""
    echo "Latest commit on main:"
    git log --oneline -1 origin/main
else
    echo "⚠️  STATUS: Main branch has differences"
    echo ""
    if [ "$MAIN_TRACKING" = "not found" ]; then
        echo "Local tracking branch not found. Run: git fetch origin main"
    else
        echo "Local and remote commits differ."
        echo "You may need to pull or push changes."
    fi
fi

echo ""
echo "==================================="

# Show current branch info
CURRENT_BRANCH=$(git branch --show-current)
echo "Current working branch: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "main" ]; then
    # Check how far ahead/behind of main
    MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || echo "")
    if [ -n "$MERGE_BASE" ]; then
        AHEAD=$(git rev-list --count origin/main..$CURRENT_BRANCH 2>/dev/null || echo "0")
        BEHIND=$(git rev-list --count $CURRENT_BRANCH..origin/main 2>/dev/null || echo "0")
        
        echo "Branch relationship to main:"
        echo "  - Commits ahead:  $AHEAD"
        echo "  - Commits behind: $BEHIND"
    fi
fi

echo "==================================="
