Browse every disk and folder on any enrolled host, create folders on the
spot, and run threads anywhere.

## What you get

- A **File Explorer** page in the left sidebar: pick a machine, tap a disk
  button (C / D / E…), follow the breadcrumb trail, copy the path, and
  create new folders inline.
- A `bb file-explorer` command with `ls`, `exists`, and `spawn` subcommands
  that do the same from a terminal or an agent thread.
- An **Any folder** environment provider for new threads: type any absolute
  Windows path and the thread runs there.

## How it works

The page lists directories through the enrolled host's daemon, so it sees
the same disks and folders a terminal on that machine would. New folders
are created on the selected host. Spawning a thread claims the path as an
attached checkout: nothing is moved or deleted. No account, API key, or
external service needed.

## For agents

The bundled skill tells an agent to list with `bb file-explorer ls`, check
paths with `bb file-explorer exists`, and start work with
`bb file-explorer spawn "<absolute-path>" --prompt "<text>"`.
