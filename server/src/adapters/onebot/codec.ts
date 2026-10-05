import {PlatformError} from "../../core/Platform";
import {Segment} from "../../domain/model";

export interface V11Segment { type: string; data: Record<string, unknown>; }

export function numericId(value: unknown): number {
    const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
        throw new PlatformError("Expected a positive integer ID", 1400);
    }
    return id;
}

function decode(value: string): string {
    return value.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");
}

function encode(value: string, parameter = false): string {
    const result = value.replace(/&/g, "&amp;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
    return parameter ? result.replace(/,/g, "&#44;") : result;
}

export function parseCq(text: string): V11Segment[] {
    const result: V11Segment[] = [];
    let offset = 0;
    for (const match of text.matchAll(/\[CQ:([a-zA-Z0-9_]+)((?:,[^\]]*)?)\]/g)) {
        if (match.index! > offset) result.push({type: "text", data: {text: decode(text.slice(offset, match.index))}});
        const data: Record<string, string> = {};
        for (const pair of match[2].split(",").slice(1)) {
            const index = pair.indexOf("=");
            if (index < 0) throw new PlatformError("Invalid CQ parameter", 1400);
            data[pair.slice(0, index)] = decode(pair.slice(index + 1));
        }
        result.push({type: match[1], data});
        offset = match.index! + match[0].length;
    }
    if (offset < text.length) result.push({type: "text", data: {text: decode(text.slice(offset))}});
    return result;
}

export function fromV11(input: unknown, autoEscape = false, base64Image?: (source: string) => string): Segment[] {
    const array: unknown = typeof input === "string"
        ? autoEscape ? [{type: "text", data: {text: input}}] : parseCq(input)
        : input;
    if (!Array.isArray(array) || array.length === 0 || array.length > 100) {
        throw new PlatformError("message must be a non-empty string or segment array (max 100)", 1400);
    }
    return array.map(value => {
        if (!value || typeof value !== "object" || !value.data || typeof value.data !== "object") {
            throw new PlatformError("Invalid message segment", 1400);
        }
        const segment = value as V11Segment;
        if (segment.type === "text" && typeof segment.data.text === "string" && segment.data.text.length <= 16000) {
            return {type: "text", text: segment.data.text};
        }
        if (segment.type === "at") {
            return {type: "mention", userId: segment.data.qq === "all" ? "all" : numericId(segment.data.qq)};
        }
        if (segment.type === "image") {
            const url = segment.data.url ?? segment.data.file;
            if (typeof url === "string" && url.startsWith("base64://") && base64Image) {
                return {type: "image", url: base64Image(url)};
            }
            if (typeof url === "string" && /^https?:\/\//.test(url)) {
                try { new URL(url); } catch { throw new PlatformError("Invalid image URL", 1400); }
                return {type: "image", url};
            }
        }
        throw new PlatformError(`Unsupported message segment: ${segment.type}`, 1400);
    });
}

/** Parse/validate all segment types before persisting images. Only resolved URLs
 * are passed to the platform; the synchronous codec stays URL-only by default. */
export async function fromV11WithImages(input: unknown, autoEscape: boolean,
    resolve: (source: string) => Promise<string>): Promise<Segment[]> {
    const segments = fromV11(input, autoEscape, source => source);
    const result: Segment[] = [];
    for (const segment of segments) {
        result.push(segment.type === "image" && segment.url.startsWith("base64://")
            ? {type: "image", url: await resolve(segment.url)} : segment);
    }
    return result;
}

export function toV11(segments: Segment[]): V11Segment[] {
    return segments.map(segment => {
        switch (segment.type) {
            case "text": return {type: "text", data: {text: segment.text}};
            case "image": return {type: "image", data: {file: segment.url, url: segment.url}};
            case "mention": return {type: "at", data: {qq: String(segment.userId)}};
        }
    });
}

export function cqString(segments: Segment[]): string {
    return segments.map(segment => {
        switch (segment.type) {
            case "text": return encode(segment.text);
            case "image": return `[CQ:image,file=${encode(segment.url, true)}]`;
            case "mention": return `[CQ:at,qq=${segment.userId}]`;
        }
    }).join("");
}
