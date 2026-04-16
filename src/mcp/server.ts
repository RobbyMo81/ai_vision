/**
 * MCP (Model Context Protocol) server for ai-vision.
 *
 * Exposes browser automation and workflow capabilities as Claude-native tools.
 * Uses stdio transport — Claude (or any MCP client) spawns this process and
 * communicates over stdin/stdout.
 *
 * Add to Claude Code's MCP config:
 *   {
 *     "mcpServers": {
 *       "ai-vision": {
 *         "command": "node",
 *         "args": ["/path/to/ai-vision/dist/cli/index.js", "serve"],
 *         "env": { "ANTHROPIC_API_KEY": "..." }
 *       }
 *     }
 *   }
 *
 * Available tools:
 *   browser_navigate          — Navigate to a URL
 *   browser_click             — Click an element
 *   browser_type              — Type text into an element
 *   browser_screenshot        — Capture the current page (returns base64 image)
 *   browser_extract           — Extract structured data from the page
 *   browser_run_task          — Run a natural-language agent task
 *   browser_request_handoff   — Pause for user interaction (HITL)
 *   workflow_run              — Execute a named or inline workflow definition
 *   workflow_list             — List available built-in workflows
 *   session_status            — Get the current session state
 */

import { z } from 'zod';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { workflowEngine } from '../workflow/engine';
import { BUILTIN_WORKFLOWS, WorkflowDefinitionSchema } from '../workflow/types';
import { registry } from '../engines/registry';

// ---------------------------------------------------------------------------
// Lazy MCP server creation (avoids loading the SDK until serve is called)
// ---------------------------------------------------------------------------

export async function createMcpServer(): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({
    name: 'ai-vision',
    version: '0.1.0',
  });

  // -------------------------------------------------------------------------
  // Tool: browser_navigate
  // -------------------------------------------------------------------------
  server.tool(
    'browser_navigate',
    'Navigate the browser to a URL. The shared session preserves cookies and auth state.',
    {
      url: z.string().describe('The URL to navigate to'),
      wait_until: z.enum(['load', 'domcontentloaded', 'networkidle'])
        .optional()
        .describe('When to consider navigation complete'),
    },
    async ({ url, wait_until }) => {
      await sessionManager.navigate(url, wait_until ?? 'load');
      const currentUrl = await sessionManager.currentUrl();
      return { content: [{ type: 'text' as const, text: `Navigated to: ${currentUrl}` }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_click
  // -------------------------------------------------------------------------
  server.tool(
    'browser_click',
    'Click an element on the current page using a CSS selector.',
    {
      selector: z.string().describe('CSS selector of the element to click'),
    },
    async ({ selector }) => {
      await sessionManager.click(selector);
      return { content: [{ type: 'text' as const, text: `Clicked: ${selector}` }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_type
  // -------------------------------------------------------------------------
  server.tool(
    'browser_type',
    'Type text into an input field on the current page.',
    {
      selector: z.string().describe('CSS selector of the input element'),
      text: z.string().describe('Text to type'),
      clear_first: z.boolean().optional().describe('Clear the field before typing'),
    },
    async ({ selector, text, clear_first }) => {
      await sessionManager.type(selector, text, clear_first);
      return { content: [{ type: 'text' as const, text: `Typed into: ${selector}` }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_screenshot
  // -------------------------------------------------------------------------
  server.tool(
    'browser_screenshot',
    'Capture a screenshot of the current browser page. Returns a base64 JPEG image.',
    {},
    async () => {
      const base64 = await sessionManager.screenshot();
      return {
        content: [
          { type: 'image' as const, data: base64, mimeType: 'image/jpeg' },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_extract
  // -------------------------------------------------------------------------
  server.tool(
    'browser_extract',
    'Extract structured information from the current page using natural language.',
    {
      instruction: z.string().describe('What to extract — e.g. "Extract the order total and confirmation number"'),
    },
    async ({ instruction }) => {
      const engine = await registry.getReady('stagehand') as import('../engines/stagehand/engine').StagehandEngine;
      const result = await engine.extractText(instruction);
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_run_task
  // -------------------------------------------------------------------------
  server.tool(
    'browser_run_task',
    'Run a natural-language browser automation task using the best available AI engine. Use this for ad-hoc tasks that do not require user authentication.',
    {
      prompt: z.string().describe('Natural language description of what to do in the browser'),
      engine: z.enum(['auto', 'browser-use', 'stagehand', 'skyvern'])
        .optional()
        .describe('Force a specific engine (default: auto-select based on task type)'),
    },
    async ({ prompt, engine }) => {
      const { routeAgentTask } = await import('../workflow/engine');
      const engineId = await routeAgentTask(prompt, engine ?? 'auto');
      const eng = await registry.getReady(engineId);
      const result = await eng.runTask(prompt);
      const lines: string[] = [
        `Engine: ${engineId}`,
        `Status: ${result.success ? 'success' : 'failed'}`,
        result.output ? `Output: ${result.output}` : '',
        result.error ? `Error: ${result.error}` : '',
        `Duration: ${result.durationMs}ms`,
      ].filter(Boolean);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: browser_request_handoff
  // -------------------------------------------------------------------------
  server.tool(
    'browser_request_handoff',
    'Pause autonomous execution and hand control to the user. Use this when the task requires human authentication or sensitive input. The browser session is preserved — cookies and page state remain intact when control is returned.',
    {
      reason: z.string().describe('Short message shown to the user explaining why their input is needed (e.g. "Please log in to your account")'),
      instructions: z.string().optional().describe('Additional instructions shown to the user (e.g. "Once logged in, click Return Control to Claude")'),
      ui_port: z.number().optional().describe('Port of the HITL UI (default: 3000)'),
    },
    async ({ reason, instructions, ui_port }) => {
      const port = ui_port ?? parseInt(process.env.AI_VISION_UI_PORT ?? '3000', 10);
      const uiUrl = `http://localhost:${port}`;

      // Signal the UI over WebSocket
      await hitlCoordinator.requestTakeover(reason, instructions);

      // This line is reached AFTER the user clicks "Return Control"
      const currentUrl = await sessionManager.currentUrl().catch(() => 'unknown');
      return {
        content: [{
          type: 'text' as const,
          text: [
            'User has returned control.',
            `Current page: ${currentUrl}`,
            'Continuing with the authenticated session.',
          ].join('\n'),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: workflow_run
  // -------------------------------------------------------------------------
  server.tool(
    'workflow_run',
    'Execute a workflow — a named sequence of browser automation steps with human-in-the-loop checkpoints. Workflows are engine-agnostic and parameter-driven.',
    {
      workflow_id: z.string().optional().describe('ID of a built-in workflow (e.g. "dispute_charge", "authenticated_task"). Omit to provide an inline definition.'),
      workflow_definition: z.string().optional().describe('JSON string of a WorkflowDefinition for one-off or custom workflows'),
      params: z.record(z.unknown()).optional().describe('Parameter values for the workflow'),
    },
    async ({ workflow_id, workflow_definition, params }) => {
      let definition = workflow_id
        ? BUILTIN_WORKFLOWS.find((w) => w.id === workflow_id)
        : undefined;

      if (!definition && workflow_definition) {
        try {
          const parsed = JSON.parse(workflow_definition);
          definition = WorkflowDefinitionSchema.parse(parsed);
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `Invalid workflow definition: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      }

      if (!definition) {
        return { content: [{ type: 'text' as const, text: `Workflow not found: '${workflow_id}'. Use workflow_list to see available workflows.` }] };
      }

      const result = await workflowEngine.run(definition, params ?? {});

      const lines: string[] = [
        `Workflow: ${definition.name}`,
        `Status: ${result.success ? 'complete' : 'failed'}`,
        `Steps: ${result.stepResults.filter((s) => s.success).length}/${result.stepResults.length} succeeded`,
        `Duration: ${result.durationMs}ms`,
      ];

      if (Object.keys(result.outputs).length > 0) {
        lines.push('\nOutputs:');
        for (const [key, value] of Object.entries(result.outputs)) {
          lines.push(`  ${key}: ${value}`);
        }
      }

      if (result.screenshots.length > 0) {
        lines.push(`\nScreenshots saved: ${result.screenshots.length}`);
        for (const s of result.screenshots) {
          lines.push(`  ${s.path}`);
        }
      }

      if (result.error) lines.push(`\nError: ${result.error}`);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: workflow_list
  // -------------------------------------------------------------------------
  server.tool(
    'workflow_list',
    'List all available built-in workflow templates with their parameters.',
    {},
    async () => {
      const lines: string[] = ['Available workflows:\n'];
      for (const wf of BUILTIN_WORKFLOWS) {
        lines.push(`  ${wf.id}`);
        lines.push(`    Name: ${wf.name}`);
        if (wf.description) lines.push(`    ${wf.description}`);
        const paramKeys = Object.keys(wf.params ?? {});
        if (paramKeys.length > 0) {
          lines.push(`    Parameters: ${paramKeys.join(', ')}`);
        }
        lines.push('');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: session_status
  // -------------------------------------------------------------------------
  server.tool(
    'session_status',
    'Get the current browser session status, phase, and HITL state.',
    {},
    async () => {
      const state = workflowEngine.currentState;
      const currentUrl = await sessionManager.currentUrl().catch(() => 'not started');
      const lines: string[] = [
        `Phase: ${state?.phase ?? 'idle'}`,
        `Current URL: ${currentUrl}`,
        `Browser active: ${sessionManager.isStarted}`,
      ];
      if (state?.currentStep) lines.push(`Current step: ${state.currentStep} (${state.stepIndex}/${state.totalSteps})`);
      if (state?.hitlReason) lines.push(`Awaiting human: ${state.hitlReason}`);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // Connect and serve
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server.connect() keeps the process alive via stdin
}
