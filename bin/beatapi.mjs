#!/usr/bin/env node

import { run } from "../src/cli.mjs";

run(process.argv.slice(2)).catch((error) => {
  if (error?.name === "BeatAPIError") {
    const requestId = error.requestId
      ? ` request_id=${error.requestId}`
      : "";
    console.error(
      `BeatAPI error: ${error.code || error.status || "request_failed"}: ${error.message}${requestId}`,
    );
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

