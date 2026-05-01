import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { cacheSize, playerScriptFetches } from "./metrics.ts";
import { PlayerScript } from "./player.ts";

const ignorePlayerScriptRegion = Deno.env.get("IGNORE_SCRIPT_REGION") === "true";

function resolveCacheHome(): string {
    const xdgCacheHome = Deno.env.get("XDG_CACHE_HOME");
    if (xdgCacheHome) return xdgCacheHome;

    const localAppData = Deno.env.get("LOCALAPPDATA");
    if (localAppData) return localAppData;

    const home =
        Deno.env.get("HOME") ??
        Deno.env.get("USERPROFILE") ??
        (() => {
            const homeDrive = Deno.env.get("HOMEDRIVE");
            const homePath = Deno.env.get("HOMEPATH");
            if (homeDrive && homePath) return `${homeDrive}${homePath}`;
            return undefined;
        })();

    if (home) return join(home, ".cache");

    return join(Deno.cwd(), ".cache");
}

export const CACHE_HOME = resolveCacheHome();
export const CACHE_DIR = join(CACHE_HOME, 'yt-cipher', 'player_cache');

const filePathCache = new Map<string, string>();

async function computeCacheKey(playerScript: PlayerScript): Promise<string> {
    if (ignorePlayerScriptRegion) {
        return playerScript.id;
    }
    const playerUrl = playerScript.toUrl();
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(playerUrl));
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getPlayerFilePath(playerScript: PlayerScript): Promise<string> {
    const playerUrl = playerScript.toUrl();

    const cached = filePathCache.get(playerUrl);
    if (cached) return cached;

    const cacheKey = await computeCacheKey(playerScript);
    const filePath = join(CACHE_DIR, `${cacheKey}.js`);

    try {
        await Deno.stat(filePath);
        filePathCache.set(playerUrl, filePath);
        return filePath;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            console.log(`Cache miss for player: ${playerUrl}. Fetching...`);
            const response = await fetch(playerUrl);
            playerScriptFetches.labels({ player_url: playerUrl, status: String(response.status) }).inc();
            if (!response.ok) {
                throw new Error(`Failed to fetch player from ${playerUrl}: ${response.statusText}`);
            }
            const playerContent = await response.text();
            await Deno.writeTextFile(filePath, playerContent);

            let fileCount = 0;
            for await (const _ of Deno.readDir(CACHE_DIR)) {
                fileCount++;
            }
            cacheSize.labels({ cache_name: 'player' }).set(fileCount);

            filePathCache.set(playerUrl, filePath);
            console.log(`Saved player to cache: ${filePath}`);
            return filePath;
        }
        throw error;
    }
}

export async function initializeCache() {
    await ensureDir(CACHE_DIR);

    let fileCount = 0;
    const thirtyDays = 14 * 24 * 60 * 60 * 1000;
    console.log(`Cleaning up player cache directory: ${CACHE_DIR}`);
    for await (const dirEntry of Deno.readDir(CACHE_DIR)) {
        if (dirEntry.isFile) {
            const filePath = join(CACHE_DIR, dirEntry.name);
            const stat = await Deno.stat(filePath);
            const lastAccessed = stat.atime?.getTime() ?? stat.mtime?.getTime() ?? stat.birthtime?.getTime();
            if (lastAccessed && (Date.now() - lastAccessed > thirtyDays)) {
                console.log(`Deleting stale player cache file: ${filePath}`);
                await Deno.remove(filePath);
            } else {
                fileCount++;
            }
        }
    }
    cacheSize.labels({ cache_name: 'player' }).set(fileCount);
    console.log(`Player cache directory ensured at: ${CACHE_DIR}`);
}
