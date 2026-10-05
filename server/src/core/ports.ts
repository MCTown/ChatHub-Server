/** Stable virtual identity directory. Implementations may persist mappings,
 * but the platform never depends on filesystem or a specific database.
 */
export interface IdentityDirectory {
    user(scope: string, uuid: string): number;
    group(nodeId: string): number;
}
