import {rmSync, cpSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Only generated server output is removed. Configuration/data are untouched.
rmSync(path.join(root, "server/dist"), {recursive: true, force: true});
const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    "--project", path.join(root, "server/tsconfig.json")], {cwd: root, stdio: "inherit"});
if (result.error) throw result.error;
if (result.status === 0) cpSync(path.join(root, "web"), path.join(root, "server/dist/web"), {recursive: true});
process.exitCode = result.status ?? 1;
