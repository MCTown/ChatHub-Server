/** Safe, user-facing management error. Never embed credentials or payloads. */
export class PluginError extends Error {
    constructor(message: string, readonly status = 500) { super(message); }
}
