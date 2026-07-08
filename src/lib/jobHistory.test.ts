import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVE_JOB_HISTORY_STATUSES,
  isActiveJobHistoryStatus,
  isTerminalJobHistoryStatus,
  TERMINAL_JOB_HISTORY_STATUSES,
} from "./jobHistory";

describe("job history status safety", () => {
  it("treats only finished job statuses as clearable", () => {
    for (const status of TERMINAL_JOB_HISTORY_STATUSES) {
      assert.equal(isTerminalJobHistoryStatus(status), true, `${status} should be terminal`);
    }

    assert.equal(isTerminalJobHistoryStatus("unknown"), false);
    assert.equal(isTerminalJobHistoryStatus(null), false);
  });

  it("keeps active job statuses out of the terminal clear list", () => {
    for (const status of ACTIVE_JOB_HISTORY_STATUSES) {
      assert.equal(isActiveJobHistoryStatus(status), true, `${status} should be active`);
      assert.equal(isTerminalJobHistoryStatus(status), false, `${status} should not be terminal`);
    }
  });
});
