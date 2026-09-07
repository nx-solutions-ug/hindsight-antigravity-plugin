import { readFileSync } from "node:fs";
import { HindsightClient } from "../client.js";
import { loadConfig } from "../config.js";
import { retainConversation } from "../retain.js";

export interface StopInput {
  conversationId?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  executionNum?: number;
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
}

export async function handleStop(rawInput: string): Promise<Record<string, any>> {
  let input: StopInput = {};
  try {
    input = JSON.parse(rawInput);
  } catch {
    return {};
  }

  const cwd = Array.isArray(input.workspacePaths) && input.workspacePaths[0]
    ? input.workspacePaths[0]
    : process.cwd();

  const config = loadConfig({ cwd });

  if (config.autoRetain && input.conversationId && input.transcriptPath) {
    try {
      const client = new HindsightClient(config);
      await retainConversation({
        conversationId: input.conversationId,
        transcriptPath: input.transcriptPath,
        client,
        config
      });
    } catch {
      // Retain errors should never prevent the agent from stopping cleanly
    }
  }

  return {};
}

export async function runStopHook(): Promise<void> {
  try {
    let stdinData = "";
    try {
      stdinData = readFileSync(0, "utf8");
    } catch {
      stdinData = "{}";
    }

    const output = await handleStop(stdinData);
    process.stdout.write(JSON.stringify(output) + "\n");
  } catch {
    process.stdout.write("{}\n");
  }
}

export { runStopHook as run };



