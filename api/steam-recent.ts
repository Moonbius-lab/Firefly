type RecentGame = {
	appid: number;
	name: string;
	playtime_2weeks: number;
	playtime_forever: number;
	img_icon_url: string;
};

export default async function handler(request: Request): Promise<Response> {
	const jsonHeaders = { "content-type": "application/json" };

	const apiKey = process.env.STEAM_API_KEY;
	if (!apiKey) {
		return new Response(
			JSON.stringify({ error: "missing STEAM_API_KEY env" }),
			{ status: 500, headers: jsonHeaders },
		);
	}

	const steamId = process.env.STEAM_ID || "76561198248501066";
	const count = 8;

	try {
		const res = await fetch(
			`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${apiKey}&steamid=${steamId}&count=${count}&format=json`,
			{ signal: AbortSignal.timeout(15000) },
		);
		if (!res.ok) {
			return new Response(
				JSON.stringify({ error: `steam api http ${res.status}` }),
				{ status: 502, headers: jsonHeaders },
			);
		}
		const json = (await res.json()) as {
			response?: { games?: RecentGame[] };
		};
		const games = (json.response?.games ?? []).map((g) => ({
			appid: g.appid,
			name: g.name,
			playtime_2weeks: g.playtime_2weeks,
			playtime_forever: g.playtime_forever,
			img_icon_url: g.img_icon_url,
		}));

		return new Response(
			JSON.stringify({ games, updatedAt: Date.now() }),
			{
				headers: {
					...jsonHeaders,
					"cache-control": "no-store, max-age=0",
				},
			},
		);
	} catch {
		return new Response(JSON.stringify({ error: "steam api fetch failed" }), {
			status: 502,
			headers: jsonHeaders,
		});
	}
}
