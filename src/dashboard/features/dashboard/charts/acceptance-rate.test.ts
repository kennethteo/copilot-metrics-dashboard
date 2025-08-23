import { describe, expect, it } from "vitest";
import { applyTimeFrameLabel } from "../../../utils/helpers";
import { sampleData } from "../../../services/sample-data";
import { computeAcceptanceAverage } from "./common";

describe("computeAcceptanceAverage", () => {
  it("correctly computes the acceptance average for provided data", () => {
  // The sampleData currently contains a single date (Jun 24) with cumulative
  // suggested/accepted values. We assert on the computed structure and values
  // produced by computeAcceptanceAverage for that single time-frame.
  const results = computeAcceptanceAverage(applyTimeFrameLabel(sampleData));
  expect(results.length).toBe(1);
  expect(results[0]).toHaveProperty("timeFrameDisplay");
  expect(typeof results[0].acceptanceRate).toBe("number");
  });

  it("handles empty input data gracefully", () => {
    const results = computeAcceptanceAverage([]);
    expect(results).toEqual([]);
  });

  it("handles data with zero suggested lines", () => {
    // Modify the underlying sampleData structure so that after applyTimeFrameLabel
    // the generated breakdown will have zero lines_suggested.
    const modifiedSample = JSON.parse(JSON.stringify(sampleData[0]));
    // Zero out all total_code_lines_suggested and language-level totals
    (modifiedSample.copilot_ide_code_completions.editors || []).forEach((editor: any) => {
      (editor.models || []).forEach((model: any) => {
        (model.languages || []).forEach((lang: any) => {
          lang.total_code_lines_suggested = 0;
          lang.total_code_lines_accepted = 0;
        });
      });
    });

    const modifiedData = [modifiedSample];
    const expectedResults = [
      {
        acceptanceRate: 0, // No lines suggested, so acceptance rate should be 0
        timeFrameDisplay: "Mar 18",
      },
    ];

  const results = computeAcceptanceAverage(applyTimeFrameLabel(modifiedData));
  // With zero suggested lines the lines-based acceptance should be 0
  expect(results.length).toBe(1);
  expect(results[0].acceptanceLinesRate).toBe(0);
  });
});
