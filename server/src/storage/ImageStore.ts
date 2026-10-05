import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {constants} from "node:fs";
import sharp from "sharp";
import {PlatformError} from "../core/Platform";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ONEBOT_MAX_PAYLOAD = 8 * 1024 * 1024;
const MAX_PIXELS = 16_000_000; // All animation frames combined.
export const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const filenamePattern = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;
const types: Record<string, string> = {png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp"};

/** Only decoded raster images are published. No client filename, path or MIME is trusted. */
export class ImageStore {
    private pending: Promise<unknown> = Promise.resolve();
    private queuedBytes = 0;

    constructor(private readonly directory: string, private readonly publicOrigin: () => string) {}

    async ingest(source: string): Promise<string> {
        const origin = this.publicOrigin();
        if (!origin) throw new PlatformError("无法发送 base64 图片：未设置公网地址，请到「平台设置」填写可供 ChatImage 下载的 HTTP(S) 公网地址。", 1400);
        const encoded = source.slice("base64://".length);
        // Buffer.from is permissive; reject invalid alphabet, padding and noncanonical trailing bits.
        if (!source.startsWith("base64://") || !encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
            throw new PlatformError("base64 图片为空或超过 5 MiB 限制。", 1400);
        }
        if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
            throw new PlatformError("base64 图片编码无效。", 1400);
        }
        if (this.queuedBytes + encoded.length > 2 * ONEBOT_MAX_PAYLOAD) {
            throw new PlatformError("待处理图片过多，请稍后重试。", 100);
        }
        this.queuedBytes += encoded.length;
        // Serialize decode + quota + write: concurrent requests cannot bypass the cache limit
        // or launch hundreds of expensive decoders at once.
        const operation = this.pending.then(async () => {
            const input = Buffer.from(encoded, "base64");
            if (input.length > MAX_IMAGE_BYTES || input.toString("base64") !== encoded) {
                throw new PlatformError("base64 图片编码无效或超过 5 MiB 限制。", 1400);
            }
            let bytes: Buffer, extension: string;
            try {
                // Some decoders tolerate a missing PNG IEND / JPEG EOI. Require the
                // complete container as well as full pixel decoding below.
                const raster = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
                    input.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex")) ||
                    input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && input.subarray(-2).equals(Buffer.from([255, 217])) ||
                    ["GIF87a", "GIF89a"].includes(input.subarray(0, 6).toString("ascii")) && input.at(-1) === 59 ||
                    input.length >= 12 && input.subarray(0, 4).toString("ascii") === "RIFF" &&
                    input.subarray(8, 12).toString("ascii") === "WEBP" && input.readUInt32LE(4) + 8 === input.length;
                if (!raster) throw new Error(); // Never pass SVG/XML or other document formats to a decoder.
                const image = sharp(input, {animated: true, limitInputPixels: MAX_PIXELS, failOn: "warning"});
                const metadata = await image.metadata();
                if (!metadata.format || !["png", "jpeg", "gif", "webp"].includes(metadata.format) ||
                    !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw new Error();
                extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
                // Full decode/re-encode rejects corrupt payloads and strips metadata/trailing content.
                bytes = await image.timeout({seconds: 10}).toBuffer();
                if (bytes.length > MAX_IMAGE_BYTES) throw new Error();
            } catch {
                throw new PlatformError("图片无效：仅支持完整的 PNG、JPEG、GIF、WebP；最大 5 MiB、总像素不超过 1600 万（含动画帧）。", 1400);
            }
            const name = `${randomBytes(32).toString("hex")}.${extension}`;
            const temporary = path.join(this.directory, `${name}.tmp`);
            try {
                await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
                const size = await this.prune();
                if (size + bytes.length > MAX_CACHE_BYTES) throw new PlatformError("图片缓存已达到 256 MiB 上限，请清理过期图片后重试。", 100);
                await fs.writeFile(temporary, bytes, {mode: 0o600, flag: "wx"});
                await fs.rename(temporary, path.join(this.directory, name));
            } catch (error) {
                await fs.unlink(temporary).catch(() => {});
                if (error instanceof PlatformError) throw error;
                throw new PlatformError("图片保存失败，请检查服务端图片目录权限和磁盘空间。", 100);
            }
            return `${origin}/media/images/${name}`;
        }).finally(() => { this.queuedBytes -= encoded.length; });
        this.pending = operation.catch(() => {});
        return operation;
    }

    async read(name: string): Promise<{bytes: Buffer; type: string} | undefined> {
        if (!filenamePattern.test(name)) return undefined;
        let handle;
        try {
            // Never follow a symlink, even if one was manually placed in the cache.
            handle = await fs.open(path.join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || Date.now() - stat.mtimeMs >= IMAGE_TTL_MS) return undefined;
            const bytes = await handle.readFile();
            return {bytes, type: types[path.extname(name).slice(1)]};
        } catch { return undefined; }
        finally { await handle?.close(); }
    }

    private async prune(): Promise<number> {
        let total = 0;
        for (const name of await fs.readdir(this.directory)) {
            if (!filenamePattern.test(name) && !/^[0-9a-f]{64}\.(png|jpg|gif|webp)\.tmp$/.test(name)) continue;
            const file = path.join(this.directory, name), stat = await fs.lstat(file);
            if (!stat.isFile()) continue;
            if (Date.now() - stat.mtimeMs >= IMAGE_TTL_MS) await fs.unlink(file);
            else total += stat.size;
        }
        return total;
    }
}
