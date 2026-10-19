// bb-plugin-file-explorer — browse disks and folders, create folders, run a thread anywhere.
//
// Registers a "File Explorer" sidebar page plus an "Any folder" environment
// provider: a free-text absolute path input (D:\..., E:\..., C:\...) instead
// of the builtin browse-only dialog. The typed path is claimed via
// experimental_claimPath and used as the thread workspace.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { mkdir as nodeMkdir } from "node:fs/promises";
import { z } from "zod";

const pathSchema = z.object({
  path: z.string().trim().min(1).max(4096),
});
type PathInputs = z.infer<typeof pathSchema>;

const threadSchema = z.object({ id: z.string() });

export const explorerInput = z.object({
  hostId: z.string().min(1).max(256).optional(),
  path: z.string().trim().max(32768).optional(),
});

export const explorerListing = z.object({
  hostId: z.string(),
  hostName: z.string(),
  directory: z.string(),
  parent: z.string().nullable(),
  entries: z.array(
    z.object({
      kind: z.enum(["directory", "file"]),
      name: z.string(),
      path: z.string(),
    }),
  ),
});

 export const rpcContract = defineRpcContract({
   drives_list: {
     input: z.null(),
     output: z.object({ drives: z.array(z.string()) }),
   },
   path_check: {
     input: z.object({ path: z.string() }),
     output: z.object({ exists: z.boolean(), path: z.string() }),
   },
  hosts_list: {
    input: z.null(),
    output: z.object({
      hosts: z.array(
        z.object({ id: z.string(), name: z.string(), online: z.boolean() }),
      ),
    }),
  },
  explore: {
    input: explorerInput,
    output: explorerListing,
  },
  paths_exist: {
    input: z.object({
      hostId: z.string().min(1).max(256).optional(),
      paths: z.array(z.string().max(32768)).min(1).max(100),
    }),
    output: z.object({ existing: z.array(z.string()) }),
  },
  drives_probe: {
    input: z.object({ hostId: z.string().min(1).max(256).optional() }),
    output: z.object({ drives: z.array(z.string()) }),
  },
  folder_create: {
    input: z.object({
      hostId: z.string().min(1).max(256).optional(),
      directory: z.string().trim().min(1).max(32768),
      name: z.string().trim().min(1).max(255),
      createProject: z.boolean().optional(),
    }),
    output: z.object({
      path: z.string(),
      projectId: z.string().nullable(),
      projectError: z.string().nullable(),
    }),
  },
 });

const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/;

function normalizePath(raw: string): string | null {
  const withBackslashes = raw.trim().replace(/\//g, "\\");
  if (!WINDOWS_ABS.test(withBackslashes)) return null;
  const stripped = withBackslashes.replace(/\\+$/, "");
  return stripped === "" ? null : stripped;
}

function parsePathInputs(inputs: unknown): PathInputs | null {
  const parsed = pathSchema.safeParse(inputs);
  return parsed.success ? parsed.data : null;
}

function splitHostArgs(raw: unknown): { hostId?: string; path?: string } {
  const parsed = explorerInput.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const out: { hostId?: string; path?: string } = {};
  if (parsed.data.hostId !== undefined && parsed.data.hostId !== "") out.hostId = parsed.data.hostId;
  if (parsed.data.path !== undefined && parsed.data.path !== "") out.path = parsed.data.path;
  return out;
}

async function resolveHostId(bb: BbPluginApi, hostId?: string): Promise<{ id: string; name: string }> {
  const hosts = await bb.sdk.hosts.list();
  if (hosts.length === 0) throw new Error("No enrolled hosts.");
  if (hostId === undefined) {
    const first = hosts[0];
    return { id: first.id, name: first.name };
  }
  const found = hosts.find((h) => h.id === hostId || h.name === hostId);
  if (!found) throw new Error(`Unknown host: ${hostId}. Known: ${hosts.map((h) => h.name).join(", ")}`);
  return { id: found.id, name: found.name };
}

 export default async function plugin(bb: BbPluginApi) {
  bb.log.info("file-explorer loaded");
 
   bb.rpc.register(rpcContract, {
     drives_list: async () => {
       // Drive enumeration runs in the inputs control via
       // bb.sdk.hosts.directory; here report the common Windows set and let
       // validate() confirm the typed path on the real host.
       return { drives: ["C:\\", "D:\\", "E:\\", "F:\\"] };
     },
     path_check: async ({ path }) => {
       const normalized = normalizePath(path);
       return { exists: normalized !== null, path: normalized ?? path };
     },
    hosts_list: async () => {
      const hosts = await bb.sdk.hosts.list();
      // Host shape varies by SDK version; read defensively.
      return {
        hosts: hosts.map((h) => {
          const rec = h as unknown as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id : String(rec.id ?? "");
          const name = typeof rec.name === "string" ? rec.name : id;
          const online = typeof rec.online === "boolean" ? rec.online : typeof rec.connected === "boolean" ? (rec.connected as boolean) : true;
          return { id, name, online };
        }),
      };
    },
    explore: async (raw) => {
      const args = splitHostArgs(raw);
      const host = await resolveHostId(bb, args.hostId);
      const listing = await bb.sdk.hosts.directory({ hostId: host.id, ...(args.path !== undefined ? { path: args.path } : {}) });
      return { hostId: host.id, hostName: host.name, directory: listing.directory, parent: listing.parent, entries: listing.entries };
    },
    paths_exist: async (raw) => {
      const parsed = z.object({ hostId: z.string().min(1).max(256).optional(), paths: z.array(z.string().max(32768)).min(1).max(100) }).safeParse(raw);
      if (!parsed.success) return { existing: [] };
      const host = await resolveHostId(bb, parsed.data.hostId);
      try {
        const res = await bb.sdk.hosts.pathsExist({ hostId: host.id, paths: parsed.data.paths });
        const existing = parsed.data.paths.filter((p) => res.existence[p] === true);
        return { existing };
      } catch {
        return { existing: [] };
      }
    },
    drives_probe: async (raw) => {
      const host = await resolveHostId(bb, raw.hostId !== "" ? raw.hostId : undefined);
      const candidates = ["C:\\", "D:\\", "E:\\", "F:\\", "G:\\", "H:\\"];
      try {
        const res = await bb.sdk.hosts.pathsExist({ hostId: host.id, paths: candidates });
        return { drives: candidates.filter((d) => res.existence[d] === true) };
      } catch {
        return { drives: ["C:\\"] };
      }
    },
    folder_create: async (raw) => {
      const host = await resolveHostId(bb, raw.hostId !== "" ? raw.hostId : undefined);
      const name = raw.name.replace(/[<>:"/\\|?*]/g, "").trim().replace(/\.+$/, "");
      if (name === "") throw new Error("Enter a folder name.");
      const base = normalizePath(raw.directory);
      if (base === null) throw new Error("Not an absolute Windows path.");
      const full = `${base}\\${name}`;
      await bb.sdk.files.mkdir({ hostId: host.id, path: full });
      if (raw.createProject === false) {
        return { path: full, projectId: null, projectError: null };
      }
      // Register as a project right away so it shows in the sidebar without
      // waiting for any polling job. Folder creation already succeeded, so a
      // registration failure is reported, not thrown.
      try {
        const key = full.toLowerCase();
        const projects = await bb.sdk.projects.list();
        const existing = projects.find((p) =>
          p.sources.some((s) => s.hostId === host.id && s.path.replace(/\\+$/, "").toLowerCase() === key),
        );
        if (existing) return { path: full, projectId: existing.id, projectError: null };
        const created = await bb.sdk.projects.create({
          name,
          source: { hostId: host.id, path: full, type: "local_path" },
        });
        return { path: full, projectId: created.id, projectError: null };
      } catch (e) {
        return { path: full, projectId: null, projectError: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  bb.experimental_environments.register({
    id: "any-folder",
    displayName: "Any folder",
    description: "Type any absolute path on any drive (D:\\Projects\\...).",
    icon: "FolderInput",
    requires: { projectless: true },
    inputs: pathSchema,
    policy: { retireGraceMs: null, pathKeys: "per-thread" },
    async validate({ inputs }) {
      const parsed = parsePathInputs(inputs);
      if (parsed === null || normalizePath(parsed.path) === null) {
        return {
          action: "refuse",
          message: "Enter an absolute Windows path, e.g. D:\\Projects\\my-app",
        };
      }
      return { action: "accept" };
    },
    experimental_existingPath(inputs) {
      const parsed = parsePathInputs(inputs);
      if (parsed === null) return null;
      return normalizePath(parsed.path);
    },
    async create(context) {
      const parsed = parsePathInputs(context.inputs);
      if (parsed === null) {
        return { status: "failed", message: "Missing or invalid path input." };
      }
      const path = normalizePath(parsed.path);
      if (path === null) {
        return {
          status: "failed",
          message: "Enter an absolute Windows path, e.g. D:\\Projects\\my-app",
        };
      }
      context.report.step(`Preparing ${path}`);
      try {
        await nodeMkdir(path, { recursive: true });
      } catch (err) {
        return {
          status: "failed",
          message: `Cannot create ${path}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      context.report.step(`Claiming ${path}`);
      const claimed = await context.experimental_claimPath(path);
      if (!claimed) {
        return {
          status: "failed",
          message: `Another environment already owns ${path}.`,
        };
      }
      return { status: "created", path, ownsPath: false };
    },
    async remove() {
      // Attached checkout: nothing to tear down.
      return { status: "removed" };
    },
  });

  const usage = [
    "Usage:",
    "  bb file-explorer spawn <absolute-path> --prompt <text> [--project <id>] [--machine <name>]",
    "  bb file-explorer ls [path] [--machine <name>]",
    "  bb file-explorer exists <path>... [--machine <name>]",
    "Example:",
    '  bb file-explorer spawn "D:\\Projects\\my-app" --prompt "Fix the edit button"',
    '  bb file-explorer ls "D:\\Projects"',
  ].join("\n");

  async function findHost(machineName: string) {
    const hosts = await bb.sdk.hosts.list();
    const host = hosts.find((c) => c.id === machineName || c.name === machineName);
    return { hosts, host };
  }

   bb.cli.register({
    name: "file-explorer",
    summary: "Browse disks and folders, create folders, spawn threads anywhere",
     commands: [
       {
         name: "spawn",
         summary: "Spawn a thread with workspace at an absolute path",
        usage: "bb file-explorer spawn <absolute-path> --prompt <text>",
       },
      {
        name: "ls",
        summary: "List a directory on an enrolled host",
        usage: "bb file-explorer ls [path] [--machine <name>]",
      },
      {
        name: "exists",
        summary: "Check which paths exist on an enrolled host",
        usage: "bb file-explorer exists <path>... [--machine <name>]",
      },
     ],
     async run(argv) {
      const [command, ...args] = argv;
      if (command === "ls") {
        const machineFlag = args.indexOf("--machine");
        const machineName = machineFlag >= 0 && args[machineFlag + 1] !== undefined ? args[machineFlag + 1] : "Home-Machine";
        const target = machineFlag >= 0 ? args.slice(0, machineFlag).join(" ").trim() : args.join(" ").trim();
        const { hosts, host } = await findHost(machineName);
        if (!host) return { exitCode: 1, stderr: `Unknown machine: ${machineName}. Known: ${hosts.map((c) => c.name).join(", ")}` };
        try {
          const listing = await bb.sdk.hosts.directory({ hostId: host.id, ...(target !== "" ? { path: target } : {}) });
          const lines = [`${listing.directory} (parent: ${listing.parent ?? "-"})`, ...listing.entries.map((e) => `${e.kind === "directory" ? "dir " : "file"}  ${e.name}`)];
          return { exitCode: 0, stdout: lines.join("\n") };
        } catch (err) {
          return { exitCode: 1, stderr: err instanceof Error ? err.message : String(err) };
        }
      }
      if (command === "exists") {
        const machineFlag = args.indexOf("--machine");
        const machineName = machineFlag >= 0 && args[machineFlag + 1] !== undefined ? args[machineFlag + 1] : "Home-Machine";
        const paths = (machineFlag >= 0 ? args.slice(0, machineFlag) : args).filter((a) => a !== "--machine");
        if (paths.length === 0) return { exitCode: 1, stderr: `Missing paths.\n${usage}` };
        const { hosts, host } = await findHost(machineName);
        if (!host) return { exitCode: 1, stderr: `Unknown machine: ${machineName}. Known: ${hosts.map((c) => c.name).join(", ")}` };
        try {
          const res = await bb.sdk.hosts.pathsExist({ hostId: host.id, paths });
          return { exitCode: 0, stdout: JSON.stringify(res) };
        } catch (err) {
          return { exitCode: 1, stderr: err instanceof Error ? err.message : String(err) };
        }
      }
      const [targetPath, ...rest] = args;
      if (command !== "spawn" || targetPath === undefined) {
        return { exitCode: 1, stderr: usage };
      }
      const path = normalizePath(targetPath);
      if (path === null) {
        return {
          exitCode: 1,
          stderr: `Not an absolute Windows path: ${targetPath}\n${usage}`,
        };
      }
      const promptFlag = rest.indexOf("--prompt");
      const projectFlag = rest.indexOf("--project");
      const machineFlag = rest.indexOf("--machine");
      const prompt =
        promptFlag >= 0 ? rest.slice(promptFlag + 1).join(" ").trim() : "";
      const projectId =
        projectFlag >= 0 && rest[projectFlag + 1] !== undefined
          ? rest[projectFlag + 1]
          : "proj_personal";
      const machineName =
        machineFlag >= 0 && rest[machineFlag + 1] !== undefined
          ? rest[machineFlag + 1]
          : "Home-Machine";
      const hosts = await bb.sdk.hosts.list();
      const host = hosts.find(
        (candidate) => candidate.id === machineName || candidate.name === machineName,
      );
      if (host === undefined) {
        return {
          exitCode: 1,
          stderr: `Unknown machine: ${machineName}. Known: ${hosts.map((candidate) => candidate.name).join(", ")}`,
        };
      }
      if (prompt === "") {
        return { exitCode: 1, stderr: `Missing --prompt text.\n${usage}` };
      }
      try {
        const raw = await bb.sdk.threads.spawn({
          environment: {
            type: "provider",
            environmentProviderId: "any-folder",
            inputs: { path },
            machine: { type: "existing", hostId: host.id },
          },
          projectId,
          prompt,
        });
        const thread = threadSchema.parse(raw);
        return {
          exitCode: 0,
          stdout: `Spawned thread ${thread.id} in ${path}`,
        };
      } catch (err) {
        return {
          exitCode: 1,
          stderr: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  bb.onDispose(() => {
  bb.log.info("file-explorer disposed");
  });
}
