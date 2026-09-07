import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { HindsightClient } from "../client.js";
import { loadConfig } from "../config.js";

const TOOLS: Tool[] = [
  {
    name: "hindsight_recall",
    description:
      "Search Hindsight memories to provide personalized, context-aware responses. Use proactively before proposing changes or answering questions about past decisions.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query or topic to recall memories about"
        },
        budget: {
          type: "string",
          enum: ["low", "mid", "high"],
          description: "Retrieval budget / depth. Default: mid"
        },
        max_tokens: {
          type: "integer",
          description: "Maximum tokens of results to return. Default: 2048"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tag filters"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "hindsight_retain",
    description:
      "Store important decisions, architectural conventions, user preferences, or learnings to long-term Hindsight memory.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Full content/notes to retain"
        },
        context: {
          type: "string",
          description: "Category/context (e.g. 'procedures', 'learnings', 'preferences', 'architecture'). Default: general"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags to categorize the memory"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["content"]
    }
  },
  {
    name: "hindsight_list_mental_models",
    description:
      "List mental models (pinned reflections/living documents) for the configured memory bank.",
    inputSchema: {
      type: "object",
      properties: {
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags to filter mental models"
        }
      }
    }
  },
  {
    name: "hindsight_get_mental_model",
    description:
      "Retrieve full details and content of a specific mental model by ID.",
    inputSchema: {
      type: "object",
      properties: {
        mental_model_id: {
          type: "string",
          description: "The unique ID of the mental model"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["mental_model_id"]
    }
  },
  {
    name: "hindsight_create_mental_model",
    description:
      "Create a new mental model (a living synthesized document automatically updated from memory).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable name (e.g. 'Coding Standards', 'Architecture Decisions')"
        },
        source_query: {
          type: "string",
          description: "The question or reflection query that defines the mental model content"
        },
        mental_model_id: {
          type: "string",
          description: "Optional alphanumeric ID"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional scope tags"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["name", "source_query"]
    }
  },
  {
    name: "hindsight_refresh_mental_model",
    description:
      "Trigger an asynchronous refresh of a mental model against latest memories.",
    inputSchema: {
      type: "object",
      properties: {
        mental_model_id: {
          type: "string",
          description: "The ID of the mental model to refresh"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["mental_model_id"]
    }
  },
  {
    name: "hindsight_reflect",
    description:
      "Perform deep synthesis and reasoning over the memory bank to answer high-level questions about past decisions.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The reflection question to synthesize an answer for"
        },
        budget: {
          type: "string",
          enum: ["low", "mid", "high"],
          description: "Reflect computation budget. Default: mid"
        },
        bank_id: {
          type: "string",
          description: "Optional bank ID override (defaults to configured bank)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "hindsight_status",
    description:
      "Check connection status, active bank, API URL, and health of the Hindsight memory service.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

export async function createMcpServer(cwd = process.cwd()): Promise<Server> {
  const config = loadConfig({ cwd });
  const client = new HindsightClient(config);

  const server = new Server(
    {
      name: "hindsight-antigravity",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "hindsight_recall": {
          let tags = args.tags as string[] | undefined;
          if (!tags && config.bankScope === "per-project-tagged" && config.projectTag) {
            tags = [config.projectTag];
          }
          const resp = await client.recall({
            query: String(args.query),
            budget: args.budget as any,
            max_tokens: args.max_tokens as any,
            tags,
            bank_id: args.bank_id as any
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(resp, null, 2)
              }
            ]
          };
        }

        case "hindsight_retain": {
          const tags = ((args.tags as string[]) || ["antigravity"]).slice();
          if (
            config.bankScope === "per-project-tagged" &&
            config.projectTag &&
            !tags.includes(config.projectTag)
          ) {
            tags.push(config.projectTag);
          }
          const item = {
            content: String(args.content),
            context: (args.context as string) || "general",
            tags,
            metadata: {
              project: config.projectName,
              scope: config.bankScope
            }
          };
          const resp = await client.retain([item], true, args.bank_id as any);
          return {
            content: [
              {
                type: "text",
                text: `Memory retained successfully. Operation ID: ${resp.operation_id || "enqueued"}`
              }
            ]
          };
        }

        case "hindsight_list_mental_models": {
          let tags = args.tags as string[] | undefined;
          if (!tags && config.bankScope === "per-project-tagged" && config.projectTag) {
            tags = [config.projectTag];
          }
          const resp = await client.listMentalModels({
            bankId: args.bank_id as any,
            detail: "content",
            tags
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(resp, null, 2)
              }
            ]
          };
        }

        case "hindsight_get_mental_model": {
          const resp = await client.getMentalModel(
            String(args.mental_model_id),
            args.bank_id as any,
            "full"
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(resp, null, 2)
              }
            ]
          };
        }

        case "hindsight_create_mental_model": {
          const tags = ((args.tags as string[]) || []).slice();
          if (
            config.bankScope === "per-project-tagged" &&
            config.projectTag &&
            !tags.includes(config.projectTag)
          ) {
            tags.push(config.projectTag);
          }
          const resp = await client.createMentalModel({
            name: String(args.name),
            source_query: String(args.source_query),
            mental_model_id: args.mental_model_id as any,
            tags,
            bank_id: args.bank_id as any
          });
          return {
            content: [
              {
                type: "text",
                text: `Mental model created with ID: ${resp.id}`
              }
            ]
          };
        }

        case "hindsight_refresh_mental_model": {
          const resp = await client.refreshMentalModel(
            String(args.mental_model_id),
            args.bank_id as any
          );
          return {
            content: [
              {
                type: "text",
                text: `Refresh enqueued. Operation ID: ${resp.operation_id}`
              }
            ]
          };
        }

        case "hindsight_reflect": {
          const resp = await client.reflect(
            String(args.query),
            (args.budget as any) || "mid",
            args.bank_id as any
          );
          return {
            content: [
              {
                type: "text",
                text: resp.answer || JSON.stringify(resp, null, 2)
              }
            ]
          };
        }

        case "hindsight_status": {
          const health = await client.health();
          const info = {
            status: health.status,
            database: health.database,
            apiUrl: config.apiUrl,
            bankId: config.bankId,
            bankScope: config.bankScope,
            projectName: config.projectName,
            projectTagPrefix: config.projectTagPrefix,
            projectTag: config.projectTag,
            bankIdTemplate: config.bankIdTemplate,
            hasApiKey: Boolean(config.apiKey),
            autoRecall: config.autoRecall,
            autoRetain: config.autoRetain,
            mentalModelsEnabled: config.mentalModelsEnabled
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(info, null, 2)
              }
            ]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${error.message || String(error)}`
          }
        ]
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Entrypoint is invoked via bin/mcp-server.js


