/** Bounded, detached diagnostic data. Never retain malformed wire text or secrets. */
export function snapshot(input: unknown, maximum = 12000): {payload: unknown; truncated: boolean} {
    let value = input;
    if (typeof input === "string") {
        try { value = JSON.parse(input); }
        catch { value = {invalid: "非 JSON 报文（不保留原文）"}; }
    }
    let budget = maximum, nodes = 500, truncated = false;
    const text = (value: string): string => {
        const length = Math.max(0, Math.min(4000, budget));
        budget -= Math.min(value.length, length);
        if (value.length <= length) return value;
        truncated = true;
        return value.slice(0, length) + "…[已截断]";
    };
    const sanitize = (value: unknown, depth = 0): unknown => {
        if (--nodes < 0 || depth > 12 || budget <= 0) { truncated = true; return "[已截断]"; }
        if (typeof value === "string") return text(value);
        if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (const item of value) {
                if (nodes <= 0 || budget <= 0) { truncated = true; result.push("[已截断]"); break; }
                result.push(sanitize(item, depth + 1));
            }
            return result;
        }
        if (value && typeof value === "object") {
            const result: Record<string, unknown> = Object.create(null);
            for (const [key, item] of Object.entries(value)) {
                if (nodes <= 0 || budget <= 0) { truncated = true; break; }
                result[text(key)] = /token|authorization|password|secret|credential/i.test(key)
                    ? "[已脱敏]" : sanitize(item, depth + 1);
            }
            return result;
        }
        return value;
    };
    return {payload: sanitize(value), truncated};
}
