#!/usr/bin/env bash
# Control A — assistant turn INCLUDES reasoning_content.
# Expectation: HTTP 200 (provider accepts the echoed reasoning field).
# Run from the proof/ directory:  bash curl-with-reasoning.sh
set -u
curl -s -w '\nHTTP %{http_code}\n' -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @test_with_reasoning.json
