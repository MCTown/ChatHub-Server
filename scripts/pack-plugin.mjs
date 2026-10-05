#!/usr/bin/env node
/**
 * 将 plugin/ 目录按 MCDReforged 规范打包成 .mcdr（本质是一个 zip）。
 *
 * 规范要求压缩包根目录必须直接包含 mcdreforged.plugin.json 和插件包目录：
 *
 *   chathub-2.0.0.mcdr
 *   ├── mcdreforged.plugin.json
 *   ├── requirements.txt
 *   └── chathub/
 *
 * 产物输出到仓库根目录的 dist/。
 */
import {createWriteStream} from "node:fs";
import {mkdir, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import archiver from "archiver";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");
const pluginDir = path.join(rootDir, "plugin");
const distDir = path.join(rootDir, "dist");

const manifestPath = path.join(pluginDir, "mcdreforged.plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.id || !manifest.version) {
    throw new Error("plugin/mcdreforged.plugin.json 缺少 id 或 version，无法确定产物名称");
}

const outFile = path.join(distDir, `${manifest.id}-${manifest.version}.mcdr`);
await mkdir(distDir, {recursive: true});

await new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = archiver("zip", {zlib: {level: 9}});

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", (error) => {
        if (error.code === "ENOENT") {
            console.warn(`[pack-plugin] 警告: ${error.message}`);
        } else {
            reject(error);
        }
    });
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(manifestPath, {name: "mcdreforged.plugin.json"});
    archive.file(path.join(pluginDir, "requirements.txt"), {name: "requirements.txt"});
    archive.glob("chathub/**/*", {
        cwd: pluginDir,
        dot: false,
        ignore: ["**/__pycache__/**", "**/*.pyc"],
    });
    void archive.finalize();
});

const {size} = await stat(outFile);
console.log(`[pack-plugin] 已生成 ${path.relative(rootDir, outFile)} (${size} bytes)`);
