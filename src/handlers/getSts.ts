import { getPlayerFilePath } from "../playerCache.ts";
import type { RequestContext, StsResponse } from "../types.ts";
import { stsCache } from "../stsCache.ts";

const stsByUrl = new Map<string, string>();

const stsPattern = /(signatureTimestamp|sts):(\d+)/;

export async function handleGetSts(ctx: RequestContext): Promise<Response> {
    const playerUrl = ctx.playerScript!.toUrl();

    const cachedByUrl = stsByUrl.get(playerUrl);
    if (cachedByUrl) {
        return new Response(JSON.stringify({ sts: cachedByUrl } as StsResponse), {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache-Hit": "true" },
        });
    }

    const playerFilePath = await getPlayerFilePath(ctx.playerScript!);

    const cachedSts = stsCache.get(playerFilePath);
    if (cachedSts) {
        stsByUrl.set(playerUrl, cachedSts);
        return new Response(JSON.stringify({ sts: cachedSts } as StsResponse), {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache-Hit": "true" },
        });
    }

    const playerContent = await Deno.readTextFile(playerFilePath);
    const match = playerContent.match(stsPattern);

    if (match && match[2]) {
        const sts = match[2];
        stsCache.set(playerFilePath, sts);
        stsByUrl.set(playerUrl, sts);
        return new Response(JSON.stringify({ sts } as StsResponse), {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache-Hit": "false" },
        });
    } else {
        return new Response(JSON.stringify({ error: "Timestamp not found in player script" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }
}
