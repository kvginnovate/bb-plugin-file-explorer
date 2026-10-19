// bb-plugin-file-explorer — frontend entry.
//
// Registers the free-text path control the New Thread environment picker
// renders beside the "Any folder" provider, plus the File Explorer sidebar page.
import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { PluginEnvironmentProviderInputsChange, PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";

type InputsChange = PluginEnvironmentProviderInputsChange;

type AnyFolderProps = PluginEnvironmentProviderInputsProps;

 /** Free-text absolute path input for the "Any folder" provider. */
function AnyFolderInputs({ value, onChange }: AnyFolderProps) {
  const initial =
    value !== null && typeof value === "object" && "path" in value &&
      typeof value.path === "string"
      ? value.path
      : "";
   const [text, setText] = useState(initial);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onChange({ status: "blocked", reason: "Type a folder path." });
    } else if (!/^[a-zA-Z]:[\\/]/.test(trimmed.replace(/\//g, "\\"))) {
      onChange({
        status: "blocked",
        reason: "Enter an absolute Windows path, e.g. D:\\Projects\\my-app",
      });
    } else {
      onChange({ status: "ready", value: { path: trimmed } });
    }
  }, [text, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="any-folder-path">
        Folder path (any drive)
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          <Icon name="FolderInput" className="size-4" />
        </span>
        <Input
          id="any-folder-path"
          className="pl-8"
          placeholder="D:\Projects\my-app"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Absolute Windows path. The folder is used as-is; nothing is created or
        deleted.
      </p>
    </div>
  );
}

function splitCrumbs(dir: string): { label: string; path: string }[] {
  const cleaned = dir.replace(/\\+$/, "");
  const match = cleaned.match(/^([a-zA-Z]:\\)?(.*)$/);
  const root = match?.[1] ?? "";
  const rest = match?.[2] ?? cleaned;
  const crumbs: { label: string; path: string }[] = [];
  if (root !== "") crumbs.push({ label: root, path: root });
  let acc = root.replace(/\\$/, "");
  for (const part of rest.split("\\").filter((p) => p !== "")) {
    acc = acc === "" ? part : `${acc}\\${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

function ExplorerPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [hosts, setHosts] = useState<{ id: string; name: string; online: boolean }[]>([]);
  const [hostId, setHostId] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [listing, setListing] = useState<{ directory: string; parent: string | null; entries: { kind: string; name: string; path: string }[] } | null>(null);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    rpc.call("hosts_list").then(
      (r) => {
        setHosts(r.hosts);
        if (r.hosts.length > 0) setHostId(r.hosts[0].id);
      },
      () => setError("Could not list hosts."),
    );
  }, [rpc]);

  async function explore(next?: string) {
    setBusy(true);
    setError("");
    try {
      const target = next !== undefined ? next : path;
      const res = await rpc.call("explore", { ...(hostId !== "" ? { hostId } : {}), ...(target !== "" ? { path: target } : {}) });
      setListing({ directory: res.directory, parent: res.parent, entries: res.entries });
      setPath(res.directory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (hostId === "") return;
    rpc.call("drives_probe", { hostId }).then(
      (r) => setDrives(r.drives),
      () => setDrives([]),
    );
    void explore("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  async function createFolder() {
    if (!listing || newName.trim() === "") return;
    setCreating(true);
    setError("");
    try {
      const res = await rpc.call("folder_create", { ...(hostId !== "" ? { hostId } : {}), directory: listing.directory, name: newName.trim() });
      setNewName("");
      await explore(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function copyPath() {
    const text = listing?.directory ?? path;
    if (text === "") return;
    try {
      const clip = navigator.clipboard;
      if (!clip) throw new Error("clipboard unavailable");
      void clip.writeText(text).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        },
        () => setError("Could not copy — long-press the path to copy it."),
      );
    } catch {
      setError("Could not copy — long-press the path to copy it.");
    }
  }

  const crumbs = listing ? splitCrumbs(listing.directory) : [];
  const dirCount = listing ? listing.entries.filter((e) => e.kind === "directory").length : 0;
  const fileCount = listing ? listing.entries.length - dirCount : 0;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ height: "100%", minHeight: "100dvh" }}>
      <div
        className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto overflow-x-hidden p-6 pb-16"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
      >
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
            <Icon name="FolderInput" className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-none tracking-tight">Path explorer</h1>
            <p className="mt-1 text-xs text-muted-foreground">Browse disks and folders on any enrolled host.</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Pick a folder, then copy the path into a new thread (environment → Any folder) or spawn from a terminal:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">bb file-explorer spawn "D:\Projects\my-app" --prompt "..."</code>
        </p>
      </div>

      {/* Source: machine + disk + typed path */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon name="Server" className="size-4 text-muted-foreground" />
            Source
          </CardTitle>
          <CardDescription>Choose where to browse from.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="explorer-host">Machine</label>
            <select
              id="explorer-host"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>{h.name}{h.online ? "" : " (offline)"}</option>
              ))}
            </select>
          </div>

          {drives.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Disks</span>
              <div className="flex flex-wrap gap-2">
                {drives.map((d) => {
                  const active = !!listing && listing.directory.toLowerCase().startsWith(d.toLowerCase());
                  return (
                    <Button
                      key={d}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => void explore(d)}
                    >
                      <Icon name="HardDrive" className="size-4" />
                      {d.replace(/\\$/, "")}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="explorer-path">Go to folder</label>
            <div className="flex gap-2">
              <Input
                id="explorer-path"
                placeholder="D:\Projects  (empty = host default)"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void explore(); }}
                spellCheck={false}
              />
              <Button onClick={() => void explore()} disabled={busy}>
                {busy ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="ArrowRight" className="size-4" />}
                {busy ? "Loading" : "Go"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error !== "" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Browser */}
      {listing && (
        <Card className="overflow-hidden">
          {/* Toolbar: breadcrumb + copy */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-sm" aria-label="Folder trail">
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-0.5">
                  {i > 0 && <Icon name="ChevronRight" className="size-3.5 text-muted-foreground" />}
                  <button
                    className="flex max-w-[11rem] items-center gap-1 truncate rounded px-1.5 py-1 hover:bg-state-hover"
                    onClick={() => void explore(c.path)}
                    title={c.path}
                  >
                    <Icon name={i === 0 ? "HardDrive" : "Folder"} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.label}</span>
                  </button>
                </span>
              ))}
            </nav>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={copyPath}>
              <Icon name={copied ? "Check" : "Copy"} className="size-4" />
              {copied ? "Copied" : "Copy path"}
            </Button>
          </div>

          {/* Action row: up + new folder */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void explore(listing.parent ?? "")}
              disabled={!listing.parent}
            >
              <Icon name="ArrowUp" className="size-4" />
              Up
            </Button>
            <div className="flex flex-1 items-center gap-2">
              <Input
                className="h-8 flex-1"
                placeholder="New folder name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }}
                spellCheck={false}
              />
              <Button size="sm" onClick={() => void createFolder()} disabled={creating || newName.trim() === ""}>
                {creating ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="FolderPlus" className="size-4" />}
                New folder
              </Button>
            </div>
          </div>

          {/* Listing */}
          {busy ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Icon name="Loader2" className="size-4 animate-spin" />
              Loading…
            </div>
          ) : listing.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Icon name="FolderOpen" className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Empty folder</p>
              <p className="text-xs text-muted-foreground">Nothing here yet — create a folder above.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {listing.entries.map((e) => {
                const isDir = e.kind === "directory";
                return (
                  <li key={e.path}>
                    <button
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-state-hover"
                      onClick={() => { if (isDir) void explore(e.path); else setPath(e.path); }}
                      title={e.path}
                    >
                      <Icon
                        name={isDir ? "Folder" : "File"}
                        className={isDir ? "size-4 shrink-0 text-foreground" : "size-4 shrink-0 text-muted-foreground"}
                      />
                      <span className="truncate">{e.name}</span>
                      {isDir && (
                        <Icon
                          name="ChevronRight"
                          className="ml-auto size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer count */}
          {!busy && listing.entries.length > 0 && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {dirCount} folder{dirCount === 1 ? "" : "s"} · {fileCount} file{fileCount === 1 ? "" : "s"}
            </div>
          )}
        </Card>
      )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: "any-folder",
    component: AnyFolderInputs,
  });
  app.slots.navPanel({
    id: "file-explorer",
    title: "File Explorer",
    icon: "FolderInput",
    path: "file-explorer",
    component: ExplorerPage,
  });
});
