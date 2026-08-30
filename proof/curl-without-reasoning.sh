#!/usr/bin/env bash
# Control B — identical body, reasoning_content field REMOVED from the assistant turn.
# Expectation: HTTP 400 ("reasoning_content ... must be passed back") — the dropped
# field is the sole difference between this and curl-with-reasoning.sh.
# Run from the proof/ directory:  bash curl-without-reasoning.sh
set -u
curl -s -w '\nHTTP %{http_code}\n' -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @test_without_reasoning.json
