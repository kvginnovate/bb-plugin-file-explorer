// bb-plugin-file-explorer — frontend entry.
//
// Registers the free-text path control the New Thread environment picker
// renders beside the "Any folder" provider, plus the File Explorer sidebar page.
import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      <Input
        id="any-folder-path"
        placeholder="D:\Projects\my-app"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
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

  return (
    <div className="mx-auto flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6 pb-10">
      <h1 className="text-lg font-semibold">Path explorer</h1>
      <p className="text-sm text-muted-foreground">
        Browse any folder on any enrolled host, then copy the path into a new thread (environment → Any folder) or spawn from a terminal:{" "}
        <code>bb file-explorer spawn "D:\Projects\my-app" --prompt "..."</code>
      </p>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="explorer-host">1 · Pick a machine</label>
        <select
          id="explorer-host"
          className="rounded border bg-background p-2 text-sm"
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>{h.name}{h.online ? "" : " (offline)"}</option>
          ))}
        </select>
      </div>
      {drives.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">2 · Pick a disk</span>
          <div className="flex flex-wrap gap-2">
            {drives.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={listing && listing.directory.toLowerCase().startsWith(d.toLowerCase()) ? "default" : "outline"}
                onClick={() => void explore(d)}
              >
                💽 {d.replace(/\\$/, "")}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="explorer-path">3 · Or type a folder</label>
        <div className="flex gap-2">
          <Input
            id="explorer-path"
            placeholder="D:\Projects  (empty = host default)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void explore(); }}
            spellCheck={false}
          />
          <Button onClick={() => void explore()} disabled={busy}>{busy ? "…" : "Go"}</Button>
        </div>
      </div>
      {error !== "" && <p className="text-sm text-red-500">{error}</p>}
      {listing && (
        <div className="flex flex-col gap-2">
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Folder trail">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">›</span>}
                <button
                  className="max-w-[10rem] truncate rounded px-1 py-0.5 hover:bg-muted hover:underline"
                  onClick={() => void explore(c.path)}
                  title={c.path}
                >
                  {i === 0 ? `💽 ${c.label}` : `📁 ${c.label}`}
                </button>
              </span>
            ))}
            <Button variant="outline" size="sm" className="ml-auto" onClick={copyPath}>{copied ? "✓ Copied" : "Copy path"}</Button>
          </nav>
          {listing.parent && <Button variant="outline" onClick={() => void explore(listing.parent ?? "")}>↑ Up</Button>}
          <div className="flex gap-2">
            <Input
              placeholder="New folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }}
              spellCheck={false}
            />
            <Button onClick={() => void createFolder()} disabled={creating || newName.trim() === ""}>{creating ? "…" : "+ New folder"}</Button>
          </div>
          <ul className="divide-y overflow-y-auto rounded border" style={{ maxHeight: "50vh", WebkitOverflowScrolling: "touch" }}>
            {listing.entries.map((e) => (
              <li key={e.path}>
                <button
                  className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-muted"
                  onClick={() => { if (e.kind === "directory") void explore(e.path); else setPath(e.path); }}
                  title={e.path}
                >
                  <span>{e.kind === "directory" ? "📁" : "📄"}</span>
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {listing.entries.length === 0 && <p className="text-sm text-muted-foreground">Empty folder.</p>}
        </div>
      )}
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
