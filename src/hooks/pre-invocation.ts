import { readFileSync } from "node:fs";
import { HindsightClient } from "../client.js";
import { loadConfig } from "../config.js";
import { formatMentalModelsForPrompt, getMentalModels } from "../mental-models.js";
import { recallForPrompt } from "../recall.js";
import { parseAntigravityTranscript } from "../retain.js";

export interface PreInvocationInput {
  conversationId?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  invocationNum?: number;
  initialNumSteps?: number;
}

export interface PreInvocationOutput {
  injectSteps: Array<{
    ephemeralMessage?: string;
    userMessage?: string;
    toolCall?: any;
  }>;
}

export async function handlePreInvocation(rawInput: string): Promise<PreInvocationOutput> {
  let input: PreInvocationInput = {};
  try {
    input = JSON.parse(rawInput);
  } catch {
    return { injectSteps: [] };
  }

  const cwd = Array.isArray(input.workspacePaths) && input.workspacePaths[0]
    ? input.workspacePaths[0]
    : process.cwd();

  const config = loadConfig({ cwd });
  const client = new HindsightClient(config);

  const blocks: string[] = [];

  // 1. Fetch and inject mental models
  if (config.mentalModelsEnabled) {
    try {
      const models = await getMentalModels(client, config);
      const formattedModels = formatMentalModelsForPrompt(
        models,
        config.bankId,
        config.bankScope,
        config.projectName
      );
      if (formattedModels) {
        blocks.push(formattedModels);
      }
    } catch {
      // Keep going if mental models fail
    }
  }

  // 2. Perform automatic recall on the user prompt
  if (config.autoRecall && input.transcriptPath) {
    try {
      const turns = parseAntigravityTranscript(input.transcriptPath);
      const lastUserTurn = turns.filter((t) => t.role === "user").at(-1);
      if (lastUserTurn?.content) {
        const recalled = await recallForPrompt(lastUserTurn.content, client, config);
        if (recalled) {
          blocks.push(recalled);
        }
      }
    } catch {
      // Keep going if recall fails
    }
  }

  if (blocks.length === 0) {
    return { injectSteps: [] };
  }

  return {
    injectSteps: [
      {
        ephemeralMessage: blocks.join("\n\n")
      }
    ]
  };
}

export async function runPreInvocation(): Promise<void> {
  try {
    let stdinData = "";
    try {
      stdinData = readFileSync(0, "utf8");
    } catch {
      stdinData = "{}";
    }

    const output = await handlePreInvocation(stdinData);
    process.stdout.write(JSON.stringify(output) + "\n");
  } catch {
    // Fail-safe: always return valid empty response
    process.stdout.write(JSON.stringify({ injectSteps: [] }) + "\n");
  }
}

export { runPreInvocation as run };



