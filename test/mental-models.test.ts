import { describe, expect, test } from "bun:test";
import { formatMentalModelsForPrompt } from "../src/mental-models.js";
import { MentalModelItem } from "../src/client.js";

describe("Mental Models Prompt Injection", () => {
  test("formatMentalModelsForPrompt returns null for empty list", () => {
    expect(formatMentalModelsForPrompt([], "test-bank")).toBeNull();
  });

  test("formatMentalModelsForPrompt formats models into markdown block", () => {
    const models: MentalModelItem[] = [
      {
        id: "coding-standards",
        bank_id: "test-bank",
        name: "Coding Standards",
        content: "- Always write TypeScript\n- Follow Airbnb style",
        tags: ["typescript", "standards"]
      },
      {
        id: "architecture",
        bank_id: "test-bank",
        name: "Architecture Guidelines",
        content: "We use microservices with event sourcing.",
        tags: ["architecture"]
      }
    ];

    const formatted = formatMentalModelsForPrompt(
      models,
      "test-bank",
      "per-project-tagged",
      "my-project"
    );
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('<hindsight_mental_models bank="test-bank" scope="per-project-tagged" project="my-project">');
    expect(formatted).toContain("#### Mental Model: Coding Standards (coding-standards)");
    expect(formatted).toContain("- Always write TypeScript");
    expect(formatted).toContain("#### Mental Model: Architecture Guidelines (architecture)");
    expect(formatted).toContain("We use microservices with event sourcing.");
    expect(formatted).toContain("</hindsight_mental_models>");
  });

  test("formatMentalModelsForPrompt skips models with empty content", () => {
    const models: MentalModelItem[] = [
      {
        id: "empty-one",
        bank_id: "test-bank",
        name: "Empty Model",
        content: "   "
      }
    ];
    expect(formatMentalModelsForPrompt(models, "test-bank")).toBeNull();
  });
});
