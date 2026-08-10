import { describe, expect, it } from "vitest";
import { cosineSim } from "./recall/math";
import { chunkText } from "./text/chunk";
import { extractHashtags } from "./text/hashtags";
import { getStatus, withStatus } from "./memory/status";
import { getVolatility, withVolatility } from "./memory/volatility";
import { EDGE_TYPES } from "./graph/types";
import { workspaceTag } from "../secondBrain";

describe("embedded Memories core", () => {
  it("chunks long memories without exceeding the model chunk limit", () => {
    const chunks = chunkText("A durable project decision. ".repeat(100));
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(1600));
  });

  it("uses normalized cosine similarity for semantic ranking", () => {
    expect(cosineSim([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSim([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it("extracts and normalizes explicit hashtags", () => {
    expect(extractHashtags("Keep this #Startup #Decision_1")).toEqual({
      cleanContent: "Keep this",
      hashtags: ["startup", "decision_1"],
    });
  });

  it("keeps workspace tags stable and excludes the All scope", () => {
    expect(workspaceTag("Startup Projects")).toBe("workspace-startup-projects");
    expect(workspaceTag("All")).toBeUndefined();
  });

  it("maintains one lifecycle and volatility verdict", () => {
    expect(withStatus(["decision", "status:draft"], "canonical")).toEqual(["decision", "status:canonical"]);
    expect(getStatus(["decision", "status:deprecated"])).toBe("deprecated");
    expect(withVolatility(["Volatility:volatile", "person"], "durable")).toEqual(["person", "volatility:durable"]);
    expect(getVolatility(["volatility:unknown", "volatility:state"])).toBe("state");
  });

  it("preserves explicit graph relationship semantics", () => {
    expect(EDGE_TYPES.relates_to.directed).toBe(false);
    expect(EDGE_TYPES.supersedes.directed).toBe(true);
    expect(EDGE_TYPES.part_of_project.label).toBe("Part of project");
  });
});
