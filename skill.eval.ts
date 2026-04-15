import { describe } from "vitest";

import { runEvalScenarios } from "../../../../tests/eval-helpers";

describe("rampaging-raccoons skill discovery", () => {
  runEvalScenarios(import.meta.dirname, [
    {
      query: "review PR 1234 with the raccoons",
      skill: "rampaging-raccoons",
      signals: ["review", "PR", "raccoons", "multi-perspective"],
    },
    {
      query: "run a multi-perspective code review on this pull request",
      skill: "rampaging-raccoons",
      signals: ["multi-perspective", "code review", "parallel agents"],
    },
    {
      query: "send the raccoons after PR 892",
      skill: "rampaging-raccoons",
      signals: ["raccoons", "PR", "review", "dispatch"],
    },
    {
      query: "do a quick bomb-sniffer review on PR 45",
      skill: "rampaging-raccoons",
      signals: ["bomb-sniffer", "review", "raccoons", "quick"],
    },
  ]);
});
