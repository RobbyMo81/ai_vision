/**
 * MCP (Model Context Protocol) server for ai-vision.
 *
 * Exposes browser automation and workflow capabilities as Claude-native tools.
 * Uses stdio transport — Claude (or any MCP client) spawns this process and
 * communicates over stdin/stdout.
 *
 * Add to Claude Code's MCP config (~/.claude.json):
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
 * Tools:
 *   browser_navigate          — Navigate to a URL
 *   browser_click             — Click an element by CSS selector
 *   browser_type              — Type text into an element
 *   browser_screenshot        — Capture the current page as a JPEG image
 *   browser_extract           — Extract text/data from the page
 *   browser_run_task          — Run a natural-language agent task
 *   browser_request_handoff   — Pause for user interaction (HITL)
 *   workflow_run              — Execute a named or inline workflow
 *   workflow_list             — List available built-in workflows
 *   session_status            — Get the current session state
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { workflowEngine } from '../workflow/engine';
import { BUILTIN_WORKFLOWS, WorkflowDefinitionSchema } from '../workflow/types';
import { registry } from '../engines/registry';
import { BridgeExitEvent, getLatestBridgeExitEvent } from '../engines/python-bridge';
import { getGeminiWriter, Platform, Tone } from '../content/gemini-writer';
import { telemetry } from '../telemetry/manager';
import { longTermMemory } from '../memory/long-term';
import { ImprovementCategory } from '../memory/types';

interface SessionStatusContext {
  phase: string;
  currentUrl: string;
  browserStarted: boolean;
  uiPort: string;
  currentStep?: string;
  stepIndex?: number;
  totalSteps?: number;
  hitlReason?: string;
  latestBridgeExit?: BridgeExitEvent | null;
}

export function buildSessionStatusLines(ctx: SessionStatusContext): string[] {
  const lines = [
    `Phase: ${ctx.phase}`,
    `URL: ${ctx.currentUrl}`,
    `Browser: ${ctx.browserStarted ? 'running' : 'not started'}`,
    `HITL UI: http://localhost:${ctx.uiPort}`,
  ];
  if (ctx.latestBridgeExit?.unexpected) {
    lines.push(
      `Bridge alert: ${ctx.latestBridgeExit.engineId} disconnected unexpectedly ` +
      `(code=${ctx.latestBridgeExit.code ?? 'null'}, signal=${ctx.latestBridgeExit.signal ?? 'null'})`
    );
  }
  if (ctx.currentStep) lines.push(`Step: ${ctx.currentStep} (${ctx.stepIndex ?? '?'}/${ctx.totalSteps ?? '?'})`);
  if (ctx.hitlReason) lines.push(`Awaiting human: ${ctx.hitlReason}`);
  return lines;
}

export async function createMcpServer(): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({
    name: 'ai-vision',
    version: '0.1.0',
  });

  // -------------------------------------------------------------------------
  // browser_navigate
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TS2589 — MCP SDK generic depth false positive with zod .describe()
  server.tool(
    'browser_navigate',
    'Navigate the browser to a URL. The shared session preserves cookies and auth state across all tools.',
    {
      url: z.string().describe('The URL to navigate to'),
      wait_until: z.string().describe('When to consider navigation complete: load | domcontentloaded | networkidle (default: load)'),
    },
    async ({ url, wait_until }) => {
      const w = (wait_until || 'load') as 'load' | 'domcontentloaded' | 'networkidle';
      await sessionManager.navigate(url, w);
      const currentUrl = await sessionManager.currentUrl();
      return { content: [{ type: 'text' as const, text: `Navigated to: ${currentUrl}` }] };
    }
  );

  // -------------------------------------------------------------------------
  // browser_click
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
  // browser_type
  // -------------------------------------------------------------------------
  server.tool(
    'browser_type',
    'Type text into an input field. Pass clear_first=true to clear the field before typing.',
    {
      selector: z.string().describe('CSS selector of the input element'),
      text: z.string().describe('Text to type'),
      clear_first: z.string().describe('Pass "true" to clear the field before typing'),
    },
    async ({ selector, text, clear_first }) => {
      await sessionManager.type(selector, text, clear_first === 'true');
      return { content: [{ type: 'text' as const, text: `Typed into: ${selector}` }] };
    }
  );

  // -------------------------------------------------------------------------
  // browser_screenshot
  // -------------------------------------------------------------------------
  server.tool(
    'browser_screenshot',
    'Capture a screenshot of the current browser page.',
    {},
    async () => {
      const base64 = await sessionManager.screenshot();
      return {
        content: [{ type: 'image' as const, data: base64, mimeType: 'image/jpeg' }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // browser_extract
  // -------------------------------------------------------------------------
  server.tool(
    'browser_extract',
    'Extract the text content of the current page. Returns raw page text for you to process.',
    {
      max_chars: z.string().describe('Maximum characters to return (default: 4000)'),
    },
    async ({ max_chars }) => {
      const page = await sessionManager.getPage();
      const pageText = await page.evaluate(
        () => document.body.innerText.replace(/\s{3,}/g, '\n').trim()
      ) as string;
      const limit = parseInt(max_chars || '4000', 10);
      return { content: [{ type: 'text' as const, text: pageText.slice(0, limit) }] };
    }
  );

  // -------------------------------------------------------------------------
  // browser_run_task
  // -------------------------------------------------------------------------
  server.tool(
    'browser_run_task',
    'Run a natural-language browser automation task using the best available AI engine.',
    {
      prompt: z.string().describe('Natural language description of what to do'),
      engine: z.string().describe('Engine override: auto | browser-use | skyvern (default: auto)'),
    },
    async ({ prompt, engine }) => {
      const { routeAgentTask } = await import('../workflow/engine');
      const engineId = await routeAgentTask(prompt, (engine || 'auto') as 'auto');
      const eng = await registry.getReady(engineId);
      const result = await eng.runTask(prompt);
      const lines = [
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
  // browser_request_handoff
  // -------------------------------------------------------------------------
  server.tool(
    'browser_request_handoff',
    'Pause and hand control to the user. Use when authentication or sensitive input is needed. The browser session (cookies, page state) is preserved when control is returned. The user sees a live browser view at the HITL UI URL.',
    {
      reason: z.string().describe('Message shown to the user: why their input is needed'),
      instructions: z.string().describe('Additional instructions for the user (e.g. "Click Return Control when logged in")'),
    },
    async ({ reason, instructions }) => {
      const port = parseInt(process.env.AI_VISION_UI_PORT ?? '3000', 10);
      const uiUrl = `http://localhost:${port}`;

      console.error(`[hitl] Waiting for user — visit ${uiUrl}`);
      // Blocks until the user clicks "Return Control to Claude" in the web UI
      await hitlCoordinator.requestTakeover(reason, instructions || undefined);

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
  // workflow_run
  // -------------------------------------------------------------------------
  server.tool(
    'workflow_run',
    'Execute a workflow — a named sequence of steps with HITL checkpoints, intelligent engine routing, and param substitution. Use workflow_list to see available workflows.',
    {
      workflow_id: z.string().describe('ID of a built-in workflow (e.g. dispute_charge, authenticated_task). Pass "inline" to provide a custom definition.'),
      params: z.string().describe('JSON object of parameter key/value pairs (e.g. {"portal_url":"https://...","charge_amount":"$47.99"})'),
      workflow_definition: z.string().describe('JSON WorkflowDefinition (only used when workflow_id is "inline")'),
    },
    async ({ workflow_id, params, workflow_definition }) => {
      let definition = BUILTIN_WORKFLOWS.find((w) => w.id === workflow_id);

      if (!definition && workflow_id === 'inline' && workflow_definition) {
        try {
          definition = WorkflowDefinitionSchema.parse(JSON.parse(workflow_definition));
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `Invalid workflow definition: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      }

      if (!definition) {
        return { content: [{ type: 'text' as const, text: `Workflow not found: '${workflow_id}'. Use workflow_list to see available IDs.` }] };
      }

      let parsedParams: Record<string, unknown> = {};
      if (params) {
        try { parsedParams = JSON.parse(params); } catch { /* ignore */ }
      }

      const result = await workflowEngine.run(definition, parsedParams);
      const lines = [
        `Workflow: ${definition.name}`,
        `Status: ${result.success ? 'complete' : 'failed'}`,
        `Steps: ${result.stepResults.filter((s) => s.success).length}/${result.stepResults.length} succeeded`,
        `Duration: ${result.durationMs}ms`,
      ];
      if (Object.keys(result.outputs).length > 0) {
        lines.push('\nOutputs:');
        for (const [k, v] of Object.entries(result.outputs)) lines.push(`  ${k}: ${v}`);
      }
      if (result.screenshots.length > 0) {
        lines.push(`\nScreenshots: ${result.screenshots.map((s) => s.path).join(', ')}`);
      }
      if (result.error) lines.push(`\nError: ${result.error}`);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // workflow_list
  // -------------------------------------------------------------------------
  server.tool(
    'workflow_list',
    'List all available built-in workflow templates with their IDs, descriptions, and parameters.',
    {},
    async () => {
      const lines = ['Available workflows:\n'];
      for (const wf of BUILTIN_WORKFLOWS) {
        lines.push(`  id: ${wf.id}`);
        lines.push(`  name: ${wf.name}`);
        if (wf.description) lines.push(`  ${wf.description}`);
        const pKeys = Object.keys(wf.params ?? {});
        if (pKeys.length > 0) lines.push(`  params: ${pKeys.join(', ')}`);
        lines.push('');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // session_status
  // -------------------------------------------------------------------------
  server.tool(
    'session_status',
    'Get the current browser session status, phase, and HITL state.',
    {},
    async () => {
      const state = workflowEngine.currentState;
      const currentUrl = await sessionManager.currentUrl().catch(() => 'not started');
      const latestBridgeExit = getLatestBridgeExitEvent();
      const lines = buildSessionStatusLines({
        phase: state?.phase ?? 'idle',
        currentUrl,
        browserStarted: sessionManager.isStarted,
        uiPort: process.env.AI_VISION_UI_PORT ?? '3000',
        currentStep: state?.currentStep,
        stepIndex: state?.stepIndex,
        totalSteps: state?.totalSteps,
        hitlReason: state?.hitlReason,
        latestBridgeExit,
      });
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // write_copy
  // -------------------------------------------------------------------------
  server.tool(
    'write_copy',
    'Generate platform-appropriate social media copy using GeminiWriter. Keeps Claude tokens free for automation work.',
    {
      platform: z.enum(['x', 'reddit', 'linkedin']).describe('Target platform'),
      topic: z.string().describe('What the post is about'),
      context: z.string().optional().describe('Background facts or details for the writer'),
      tone: z.enum(['factual', 'conversational', 'professional', 'direct']).optional()
        .describe('Writing tone (default: conversational)'),
      include_title: z.boolean().optional().describe('For Reddit only: also generate a post title'),
    },
    async ({ platform, topic, context, tone, include_title }) => {
      const writer = getGeminiWriter();
      const post = await writer.writePost({
        platform: platform as Platform,
        topic,
        context,
        tone: tone as Tone | undefined,
        includeTitle: include_title ?? false,
      });
      const lines: string[] = [`Model: ${post.model}`, `Platform: ${post.platform}`];
      if (post.title) lines.push(`Title: ${post.title}`);
      lines.push('', post.text);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // -------------------------------------------------------------------------
  // query_telemetry
  // -------------------------------------------------------------------------
  server.tool(
    'query_telemetry',
    'Query recent telemetry events from the telemetry database. Use type="alerts" to see only error/warn events with detected issues.',
    {
      type: z.enum(['recent', 'alerts']).optional()
        .describe('Which events to return: recent (default) or alerts (issues only)'),
      limit: z.number().int().min(1).max(200).optional()
        .describe('Maximum number of events to return (default: 20)'),
      level: z.enum(['debug', 'info', 'warn', 'error']).optional()
        .describe('Filter by severity level'),
    },
    async ({ type = 'recent', limit = 20, level }) => {
      const events = type === 'alerts'
        ? telemetry.recentAlerts(limit)
        : telemetry.recent(limit);
      const filtered = level ? events.filter(e => e.level === level) : events;
      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
    }
  );

  // -------------------------------------------------------------------------
  // read_memory
  // -------------------------------------------------------------------------
  server.tool(
    'read_memory',
    'Read from long-term memory. Retrieve improvements, SIC enhancements, or workflow stories.',
    {
      type: z.enum(['improvements', 'sic', 'stories', 'story']).describe(
        'improvements: all improvement records; sic: only SIC-promoted ones; stories: list all stories; story: fetch one story by id'
      ),
      id: z.string().optional().describe('Story ID (required when type=story)'),
    },
    async ({ type, id }) => {
      let data: unknown;
      if (type === 'improvements') {
        data = longTermMemory.getAllImprovements();
      } else if (type === 'sic') {
        data = longTermMemory.getSicEnhancements();
      } else if (type === 'stories') {
        data = longTermMemory.listStories();
      } else {
        if (!id) return { content: [{ type: 'text' as const, text: 'id is required when type=story' }] };
        data = longTermMemory.getStory(id);
        if (!data) return { content: [{ type: 'text' as const, text: `Story not found: ${id}` }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // -------------------------------------------------------------------------
  // write_memory
  // -------------------------------------------------------------------------
  server.tool(
    'write_memory',
    'Record a new improvement observation to long-term memory. Increments the occurrence counter if the id already exists; auto-promotes to SIC at 3 occurrences.',
    {
      id: z.string().describe('Stable identifier for this improvement pattern (e.g. "salesforce-dropdown-click-wait")'),
      category: z.enum(['dropdown', 'autocomplete', 'file-upload', 'navigation', 'form-validation', 'timing', 'general'])
        .describe('Improvement category'),
      title: z.string().describe('Short human-readable title'),
      description: z.string().describe('What was observed and why it matters'),
      agent_instruction: z.string().describe('Instruction prepended to future agent prompts when this is SIC-promoted'),
      workflow_id: z.string().describe('Workflow ID where this was observed'),
    },
    async ({ id, category, title, description, agent_instruction, workflow_id }) => {
      const imp = longTermMemory.recordImprovement({
        id,
        category: category as ImprovementCategory,
        title,
        description,
        agentInstruction: agent_instruction,
        workflowId: workflow_id,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(imp, null, 2) }] };
    }
  );

  // -------------------------------------------------------------------------
  // list_workflows
  // -------------------------------------------------------------------------
  server.tool(
    'list_workflows',
    'List workflow YAML files available in the workflows/ directory.',
    {},
    async () => {
      const workflowsDir = path.join(process.cwd(), 'workflows');
      let files: string[] = [];
      try {
        files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      } catch {
        return { content: [{ type: 'text' as const, text: 'No workflows directory found.' }] };
      }
      const lines = [`Workflows in ${workflowsDir}:\n`];
      for (const file of files) {
        const filePath = path.join(workflowsDir, file);
        let preview = '';
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const nameMatch = content.match(/^name:\s*(.+)/m);
          const descMatch = content.match(/^description:\s*[>|]?\s*\n?\s*(.+)/m);
          if (nameMatch) preview += `  name: ${nameMatch[1].trim()}`;
          if (descMatch) preview += `\n  description: ${descMatch[1].trim()}`;
        } catch { /* skip */ }
        lines.push(`- ${file}${preview ? '\n' + preview : ''}`);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
