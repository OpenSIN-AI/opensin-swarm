declare module "@opencode-ai/sdk" {
  export interface Config {
    model?: string;
    agent?: Record<string, { model?: string }>;
  }
}

declare module "@opencode-ai/plugin" {
  export type ShellResult = {
    exitCode: number;
    text(): string;
    stderr: { toString(): string };
  };

  export interface ToolContext {
    sessionID: string;
    directory: string;
    worktree: string;
    agent: string;
  }

  export interface ToolSchema {
    string(): {
      min(value: number): any;
      optional(): any;
      describe(value: string): any;
    };
    number(): {
      min(value: number): any;
      max(value: number): any;
      optional(): any;
      describe(value: string): any;
    };
    boolean(): { optional(): any; describe(value: string): any };
    array(item: any): {
      optional(): any;
      describe(value: string): any;
    };
    object(shape: Record<string, any>): any;
  }

  export interface ToolFactory {
    schema: ToolSchema;
    <T>(definition: T): T;
  }

  export interface PluginInitArgs {
    client: any;
    $: BunShell;
  }

  export interface PluginResult {
    config?: (cfg: import("@opencode-ai/sdk").Config) => void | Promise<void>;
    tool: Record<string, any>;
  }

  export type Plugin = (args: PluginInitArgs) => Promise<PluginResult> | PluginResult;

  export const tool: ToolFactory;

  export type BunShell = {
    cwd(dir: string): BunShell;
    nothrow(): BunShell;
    escape(value: string): string;
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<ShellResult>;
  };
}

declare module "@opencode-ai/plugin/dist/shell" {
  export type BunShell = import("@opencode-ai/plugin").BunShell;
}
