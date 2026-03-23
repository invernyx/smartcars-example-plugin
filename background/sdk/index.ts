/**
 * smartCARS Plugin SDK
 *
 * Minimal types and constants needed to build a smartCARS background plugin.
 * Copy this file into your own plugin — it has no runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface SmartCARSIdentity {
    id: number;
    hasPremium: boolean;
    token: string;
    expiry: number;
    firstName: string;
    lastNameInitial: string;
    authority: number;
    developer: boolean;
    tester: boolean;
    showHost: boolean;
}

export interface CommunityIdentity {
    dbID: number;
    pilotID: string;
    firstName: string;
    lastName: string;
    email: string;
    rank: string;
    rankImage: string | null;
    rankLevel: number;
    avatar: string | null;
    session: string;
}

export interface CommunityPlugin {
    id: string;
    name: string;
    verified: boolean;
    downloads: number;
    rating: number;
    totalReviews: number;
    author: string;
    description: string;
    lastUpdated: string;
    version: string;
    type: string;
    availableSettings: any;
    appliedSettings: any;
}

export interface CommunityDetails {
    id: number;
    isPartner: boolean;
    name?: string;
    settings: {
        airlineName: string;
        airlineICAO: string;
        accentBackgroundColor: string;
        accentForegroundColor: string;
        welcomeMessage: string | null;
        maintenanceMode: boolean;
        logo: string;
        logoDark: string;
        icon: string;
        scriptURL: string;
        vaURL: string;
        ico?: string;
        scriptVersion?: string;
        scriptHandler?: string;
    };
    readonly plugins: readonly CommunityPlugin[];
}

/** Full identity object passed to `onStart`. */
export interface RawIdentity {
    tfdi_design_user?: SmartCARSIdentity;
    airline: CommunityDetails;
    va_user: CommunityIdentity;
    /** Writable directory scoped to this plugin for persistent storage. */
    storagePath: string;
}

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------

/** Minimal request surface exposed to plugin route handlers. */
export interface PluginRouteRequest {
    readonly method: string;
    readonly url: string;
    readonly params: Record<string, string>;
    readonly query: Record<string, string | string[]>;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: unknown;
}

/** Minimal response surface exposed to plugin route handlers. */
export interface PluginRouteResponse {
    status(code: number): this;
    json(body: unknown): void;
    send(body?: unknown): void;
}

export interface PluginRouteDefinition {
    description?: string;
    handler: (req: PluginRouteRequest, res: PluginRouteResponse) => void | Promise<void>;
}

/**
 * The full export contract for a plugin's background module.
 * Export a value of this type as the CommonJS default export (`export = plugin`).
 */
export interface PluginDefinition {
    /** Called once when the plugin is loaded, with the current user identity. */
    readonly onStart?: (identity: RawIdentity) => void;
    /** Called once when the plugin is unloaded. May return a Promise that will be awaited. */
    readonly onEnd?: () => void | Promise<void>;
    /** Called when the plugin's settings are updated. */
    readonly onSettingsUpdate?: (settings: any) => void;
    /**
     * Express-style route handlers, keyed by HTTP method then handler name.
     * Dispatched via GET/POST /api/:pluginId/:handlerName.
     */
    readonly routes?: Partial<Record<string, Record<string, PluginRouteDefinition>>>;
}

// ---------------------------------------------------------------------------
// Local server constants
// ---------------------------------------------------------------------------

/** Port the smartCARS HTTP API server listens on. */
export const LOCAL_HTTP_PORT = 7172;
/** Base URL for the smartCARS HTTP API server. */
export const LOCAL_HTTP_URL = `http://127.0.0.1:${LOCAL_HTTP_PORT}`;
