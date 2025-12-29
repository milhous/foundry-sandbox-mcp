import { z } from "zod";
import { runForgeInDocker } from "./utils/runForgeInDocker.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const BaseInputSchema = z.object({
  projectPath: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

const ForgeTestInputSchema = BaseInputSchema.extend({
  matchPath: z.string().min(1).optional(),
  extraArgs: z.array(z.string().min(1)).optional(),
});

const ForgeBuildInputSchema = BaseInputSchema.extend({
  extraArgs: z.array(z.string().min(1)).optional(),
});

const ForgeCleanInputSchema = BaseInputSchema;

function formatCommandResult(result: {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  const sections: string[] = [];
  sections.push(`$ ${result.command}`);
  sections.push(`exitCode: ${result.exitCode ?? "unknown"}`);
  if (result.stdout.trim()) sections.push(`\nstdout:\n${result.stdout}`);
  if (result.stderr.trim()) sections.push(`\nstderr:\n${result.stderr}`);
  return sections.join("\n");
}

async function executeForgeCommand<T extends z.ZodTypeAny>(
  rawArguments: unknown,
  schema: T,
  forgeArgsBuilder: (input: z.infer<T>) => string[],
): Promise<ToolResult> {
  const input = schema.parse(rawArguments ?? {});

  const result = await runForgeInDocker({
    projectPath: input.projectPath,
    forgeArgs: forgeArgsBuilder(input),
    timeoutMs: input.timeoutMs,
  });

  return { content: [{ type: "text", text: formatCommandResult(result) }] };
}

export const toolDefinitions = [
  {
    name: "forge_test",
    description: "Run `forge test` inside the Docker sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Host path to the Foundry project directory.",
        },
        matchPath: {
          type: "string",
          description: "Passed to `forge test --match-path`.",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "Additional arguments appended to `forge test`.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 300000).",
        },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "forge_build",
    description: "Run `forge build` inside the Docker sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Host path to the Foundry project directory.",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "Additional arguments appended to `forge build`.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 300000).",
        },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "forge_clean",
    description: "Run `forge clean` inside the Docker sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Host path to the Foundry project directory.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 300000).",
        },
      },
      required: ["projectPath"],
    },
  },
] as const;

export const toolHandlers: Record<
  string,
  (rawArguments: unknown) => Promise<ToolResult>
> = {
  async forge_test(rawArguments) {
    return executeForgeCommand(
      rawArguments,
      ForgeTestInputSchema,
      (input) => {
        const args: string[] = ["test"];
        if (input.matchPath) args.push("--match-path", input.matchPath);
        if (input.extraArgs?.length) args.push(...input.extraArgs);
        return args;
      },
    );
  },

  async forge_build(rawArguments) {
    return executeForgeCommand(
      rawArguments,
      ForgeBuildInputSchema,
      (input) => {
        const args: string[] = ["build"];
        if (input.extraArgs?.length) args.push(...input.extraArgs);
        return args;
      },
    );
  },

  async forge_clean(rawArguments) {
    return executeForgeCommand(rawArguments, ForgeCleanInputSchema, () => ["clean"]);
  },
};
