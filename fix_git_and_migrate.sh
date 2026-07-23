#!/usr/bin/env bash
set -e

# Make sure we are in the repository root directory
cd "$(dirname "$0")"

echo "=== FreeLLMAPI Post-Merge Repair & Sync ==="

echo "1. Configuring local repository Git identity..."
git config user.name "Ashutosh Sahoo"
git config user.email "sahooashutosh2022@gmail.com"

echo "2. Amending the merge commit with the correct author/committer..."
git commit --amend --reset-author --no-edit

echo "3. Rebuilding native better-sqlite3 addon..."
# Rebuild the sqlite native library using allowed scripts config
npm rebuild better-sqlite3

echo "4. Running database migrations using native node loader..."
# Use node --import tsx to bypass executable permission errors on the tsx binary
node --import tsx server/src/db/migrate/cli.ts up

echo "5. Force-pushing to your fork (origin) to align it with upstream..."
git push -f origin main

echo "=== Repair and Sync Completed Successfully ==="
echo "You can now run 'npm run dev' to start the application."
