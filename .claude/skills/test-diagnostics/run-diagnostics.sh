#!/bin/bash
# Test Diagnostics — Profile all test files to find slow, hanging, or failing tests
#
# Usage: ./run-diagnostics.sh [--timeout 30] [--slow-threshold 5] [--dir .]
#
# Output: Sorted report with HANG/FAIL/SLOW/PASS for each test file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/../../.."

cd "$PROJECT_DIR"

# Defaults
TIMEOUT=30
SLOW_THRESHOLD=5
SEARCH_DIR="."

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --slow-threshold) SLOW_THRESHOLD="$2"; shift 2 ;;
    --dir) SEARCH_DIR="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--timeout 30] [--slow-threshold 5] [--dir .]"
      echo ""
      echo "Options:"
      echo "  --timeout N          Kill tests after N seconds (default: 30)"
      echo "  --slow-threshold N   Report tests taking > N seconds as SLOW (default: 5)"
      echo "  --dir PATH           Search for tests under PATH (default: .)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Colors
if [ -t 1 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED='' YELLOW='' GREEN='' CYAN='' NC=''
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Diagnostics — timeout: ${TIMEOUT}s, slow threshold: ${SLOW_THRESHOLD}s"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Collect results
hangs=()
fails=()
slow=()
ok=()
total=0
total_time=0

for f in $(find "$SEARCH_DIR" -name "*.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" | sort); do
  total=$((total + 1))
  start=$(date +%s)

  if timeout "$TIMEOUT" bun test "$f" > /dev/null 2>&1; then
    end=$(date +%s)
    duration=$((end - start))
    total_time=$((total_time + duration))

    if [ "$duration" -ge "$SLOW_THRESHOLD" ]; then
      slow+=("${duration}s $f")
      printf "${YELLOW}SLOW${NC} %3ds  %s\n" "$duration" "$f"
    else
      ok+=("${duration}s $f")
      printf "${GREEN}PASS${NC} %3ds  %s\n" "$duration" "$f"
    fi
  else
    exit_code=$?
    end=$(date +%s)
    duration=$((end - start))
    total_time=$((total_time + duration))

    if [ $exit_code -eq 124 ]; then
      hangs+=("${TIMEOUT}s+ $f")
      printf "${RED}HANG${NC} %3ds+ %s\n" "$TIMEOUT" "$f"
    else
      fails+=("${duration}s $f")
      printf "${RED}FAIL${NC} %3ds  %s\n" "$duration" "$f"
    fi
  fi
done

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total: $total files, ${total_time}s elapsed"
echo ""
printf "${GREEN}PASS${NC}:  %d\n" "${#ok[@]}"
printf "${YELLOW}SLOW${NC}:  %d (>${SLOW_THRESHOLD}s)\n" "${#slow[@]}"
printf "${RED}FAIL${NC}:  %d\n" "${#fails[@]}"
printf "${RED}HANG${NC}:  %d (>${TIMEOUT}s timeout)\n" "${#hangs[@]}"

if [ ${#hangs[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}HANGING TESTS (need investigation):${NC}"
  for h in "${hangs[@]}"; do echo "  $h"; done
fi

if [ ${#fails[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}FAILING TESTS:${NC}"
  for f in "${fails[@]}"; do echo "  $f"; done
fi

if [ ${#slow[@]} -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}SLOW TESTS (>${SLOW_THRESHOLD}s):${NC}"
  for s in "${slow[@]}"; do echo "  $s"; done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
