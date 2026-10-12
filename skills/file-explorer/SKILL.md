# File Explorer

Browse every disk and folder on any enrolled host, create folders, and run
bb threads with a workspace in any folder on any drive.

## GUI

Sidebar → **File Explorer**:

1. Pick a machine (enrolled host).
2. Tap a disk button (💽 C / D / E…) or type a folder path.
3. Follow the folder trail (💽 › 📁 › …), then **Copy path**.
4. **+ New folder** creates a folder in the open directory.

Tap a folder row to enter it; tap a file row to put its path in the box.
The list scrolls inside the page. Then paste the path into a new thread
(environment → **Any folder**) or spawn from a terminal.

## Commands

- `bb file-explorer ls [path] [--machine <name>]` — list a directory (empty = host default).
- `bb file-explorer exists <path>... [--machine <name>]` — check which paths exist.
- `bb file-explorer spawn "<absolute-path>" --prompt "<text>" [--project <id>] [--machine <name>]`
  - Example: `bb file-explorer spawn "D:\Projects\my-app" --prompt "Fix the bug"`
  - Path must be absolute Windows (`D:\...`, `E:\...`). The folder is used
    as-is for the thread workspace: nothing is moved or deleted.
  - Omit `--project` to use the remembered project default.

## GUI (new thread)

New thread → environment → **Any folder** → type the path in the inputs
control beside the picker.
