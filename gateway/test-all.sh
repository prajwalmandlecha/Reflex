#!/usr/bin/env bash
# AGP Gateway - Complete Feature Test Suite Runner
# Run this script to test all 8 core platform features against the live Docker stack.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================================="
echo "    Launching AGP Gateway Verification Suite..."
echo "=========================================================================="

go run -buildvcs=false ./cmd/test-all
