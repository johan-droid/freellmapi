#!/usr/bin/env bash
set -e

# Make sure we are in the repository root directory
cd "$(dirname "$0")"

echo "=== FreeLLMAPI Finish Merge and Migrate ==="

echo "1. Configuring local repository Git identity..."
git config user.name "Ashutosh Sahoo"
git config user.email "sahooashutosh2022@gmail.com"

echo "2. Resolving package-lock.json conflict..."
git checkout --ours package-lock.json

echo "3. Adding resolved files..."
git add -A

echo "4. Committing the merge..."
# Commit the merge
if ! git commit -m "Merge upstream/main and resolve conflicts" 2>/dev/null; then
  echo "Commit already created or merge complete."
fi

echo "5. Installing npm dependencies..."
npm install --no-audit --no-fund

echo "6. Running database migrations..."
npm run db:migration:up

echo "=== Merge and Sync Completed Successfully ==="
echo "You can now run 'npm run dev' to start the application."
