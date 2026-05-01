import { execInPool } from "./workerPool.ts";
import { getPlayerFilePath } from "./playerCache.ts";
import { preprocessedCache } from "./preprocessedCache.ts";
import { solverCache } from "./solverCache.ts";
import { getFromPrepared } from "../ejs/src/yt/solver/solvers.ts";
import type { Solvers } from "./types.ts";
import { workerErrors } from "./metrics.ts";
import { PlayerScript, PlayerVariant } from "./player.ts";

const SOLVER_VARIANT_FALLBACK: Partial<Record<PlayerVariant, PlayerVariant>> = {
    [PlayerVariant.EMBED]: PlayerVariant.IAS,
    [PlayerVariant.EMBED_TCE]: PlayerVariant.IAS,
};

const solversByUrl = new Map<string, Solvers>();

export async function getSolvers(playerScript: PlayerScript): Promise<Solvers | null> {
    const fallbackVariant = SOLVER_VARIANT_FALLBACK[playerScript.variant];
    const solverScript = fallbackVariant
        ? playerScript.withVariant(fallbackVariant)
        : playerScript;

    const playerUrl = solverScript.toUrl();

    const cached = solversByUrl.get(playerUrl);
    if (cached) return cached;

    const playerCacheKey = await getPlayerFilePath(solverScript);

    let solvers = solverCache.get(playerCacheKey);
    if (solvers) {
        solversByUrl.set(playerUrl, solvers);
        return solvers;
    }

    let preprocessedPlayer = preprocessedCache.get(playerCacheKey);
    if (!preprocessedPlayer) {
        const rawPlayer = await Deno.readTextFile(playerCacheKey);
        try {
            preprocessedPlayer = await execInPool(rawPlayer);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            workerErrors.labels({ player_id: solverScript.id, player_type: solverScript.variant, message }).inc();
            throw e;
        }
        preprocessedCache.set(playerCacheKey, preprocessedPlayer);
    }

    solvers = getFromPrepared(preprocessedPlayer);
    if (solvers) {
        solverCache.set(playerCacheKey, solvers);
        solversByUrl.set(playerUrl, solvers);
        return solvers;
    }

    return null;
}
