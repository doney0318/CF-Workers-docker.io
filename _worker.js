// ========== 你只需要改这里 ==========
const AUTH_ENABLED = true; // 开启密码验证
const USER = "doney";      // 用户名
const PASS = "dvub(tR6BO"; // 密码
// ====================================

let hub_host = "registry-1.docker.io";
const auth_url = "https://auth.docker.io";
let workers_url = "";

const BLOCK_UA = ["netcraft", "python", "curl", "wget"];

function routeByHosts(host) {
	const routes = {
		"quay": "quay.io",
		"gcr": "gcr.io",
		"k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io",
		"ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io",
	};
	if (host in routes) return [routes[host], false];
	else return [hub_host, true];
}

const PREFLIGHT_INIT = {
	headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-max-age": "1728000" },
};

function makeRes(body, status = 200, headers = {}) {
	headers["access-control-allow-origin"] = "*";
	return new Response(body, { status, headers });
}

function checkAuth(authHeader) {
	if (!AUTH_ENABLED) return true;
	try {
		const [type, b64] = authHeader.split(" ");
		if (type !== "Basic") return false;
		const [user, pass] = atob(b64).split(":");
		return user === USER && pass === PASS;
	} catch (e) {
		return false;
	}
}

export default {
	async fetch(request, env) {
		workers_url = `https://${new URL(request.url).hostname}`;

		// === 密码验证 ===
		if (AUTH_ENABLED) {
			const auth = request.headers.get("Authorization");
			if (!auth || !checkAuth(auth)) {
				return new Response("Unauthorized", {
					status: 401,
					headers: { "WWW-Authenticate": "Basic realm=\"Docker Proxy\"" },
				});
			}
		}

		const url = new URL(request.url);
		const pathname = url.pathname;
		const userAgent = (request.headers.get("User-Agent") || "").toLowerCase();

		// 屏蔽爬虫
		if (BLOCK_UA.some((u) => userAgent.includes(u))) {
			return new Response("Forbidden", { status: 403 });
		}

		// 路由上游
		const hostTop = url.hostname.split(".")[0];
		const [upstream, fakePage] = routeByHosts(hostTop);
		hub_host = upstream;

		// 处理 token
		if (pathname === "/token") {
			const tokenUrl = auth_url + pathname + url.search;
			const resp = await fetch(tokenUrl, request);
			const newResp = new Response(resp.body, resp);
			const authHeader = newResp.headers.get("Www-Authenticate");
			if (authHeader) {
				newResp.headers.set("Www-Authenticate", authHeader.replace(auth_url, workers_url));
			}
			return newResp;
		}

		// 处理首页
		if (pathname === "/" && fakePage) {
			return Response.redirect("https://hub.docker.com", 302);
		}

		// 转发真实请求
		url.hostname = hub_host;
		const newHeaders = new Headers(request.headers);
		newHeaders.set("Host", hub_host);

		let resp = await fetch(url, {
			method: request.method,
			headers: newHeaders,
			body: request.body,
			redirect: "follow",
		});

		// 处理重定向
		if (resp.headers.get("Location")) {
			return Response.redirect(resp.headers.get("Location"), 302);
		}

		// 修复认证域
		const wwwAuth = resp.headers.get("Www-Authenticate");
		if (wwwAuth) {
			const newResp = new Response(resp.body, resp);
			newResp.headers.set("Www-Authenticate", wwwAuth.replace(auth_url, workers_url));
			return newResp;
		}

		return resp;
	},
};
