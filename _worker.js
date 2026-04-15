// ========== 你自己配置 ==========
const USER = "doney";          // 用户名
const PASS = "dvub(tR6BO";  // 密码
const USE_AUTH = true;         // 是否开启密码验证
// ===============================

// 使用 ES modules 格式（推荐）
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};

async function handleRequest(request) {
  const url = new URL(request.url);
  const authorization = request.headers.get("Authorization");

  // 认证
  if (USE_AUTH) {
    if (!authorization || !checkAuth(authorization)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": "Basic realm=\"Docker Proxy\""
        }
      });
    }
  }

  // 处理 Docker Registry v2 API
  if (url.pathname === "/v2/") {
    return handleV2Root(request);
  }

  // 代理 token 请求
  if (url.pathname.includes("/token")) {
    return proxyToken(request);
  }

  return proxyRequest(request);
}

function checkAuth(auth) {
  try {
    const [user, pass] = atob(auth.split(" ")[1]).split(":");
    return user === USER && pass === PASS;
  } catch {
    return false;
  }
}

async function handleV2Root(request) {
  const url = new URL(request.url);
  const targetUrl = new URL("https://registry-1.docker.io/v2/");
  
  try {
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: cleanHeaders(request.headers),
      redirect: "follow"
    });

    const newResponse = new Response(response.body, response);
    
    const authHeader = newResponse.headers.get("Www-Authenticate");
    if (authHeader) {
      newResponse.headers.set(
        "Www-Authenticate",
        authHeader.replace(/realm="[^"]*"/, `realm="${url.origin}/token"`)
      );
    }
    
    return newResponse;
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

async function proxyToken(request) {
  const url = new URL(request.url);
  const service = url.searchParams.get("service") || "registry.docker.io";
  let authServer = "auth.docker.io";
  
  if (service.includes("ghcr.io")) {
    authServer = "ghcr.io";
  } else if (service.includes("quay.io")) {
    authServer = "quay.io";
  } else if (service.includes("gcr.io")) {
    authServer = "gcr.io";
  } else if (service.includes("k8s.io")) {
    authServer = "registry.k8s.io";
  }

  const targetUrl = new URL(`https://${authServer}${url.pathname}${url.search}`);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: cleanHeaders(request.headers),
      body: request.body,
      redirect: "follow"
    });

    const newResponse = new Response(response.body, response);
    
    const authHeader = newResponse.headers.get("Www-Authenticate");
    if (authHeader) {
      const replacedAuth = authHeader.replace(
        /realm="https?:\/\/[^/"]+/g,
        `realm="${url.origin}`
      );
      newResponse.headers.set("Www-Authenticate", replacedAuth);
    }

    return newResponse;
  } catch (error) {
    return new Response(`Token Error: ${error.message}`, { status: 500 });
  }
}

async function proxyRequest(request) {
  const url = new URL(request.url);
  let targetHost = "registry-1.docker.io";

  const hostMap = {
    "docker": "registry-1.docker.io",
    "ghcr": "ghcr.io",
    "quay": "quay.io",
    "gcr": "gcr.io",
    "k8s": "registry.k8s.io",
    "k8s-gcr": "k8s.gcr.io"
  };

  const subdomain = url.hostname.split(".")[0];
  if (hostMap[subdomain]) {
    targetHost = hostMap[subdomain];
  }

  const targetUrl = new URL(`https://${targetHost}${url.pathname}${url.search}`);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: cleanHeaders(request.headers),
      body: request.body,
      redirect: "follow"
    });

    const newResponse = new Response(response.body, response);
    
    const authHeader = newResponse.headers.get("Www-Authenticate");
    if (authHeader) {
      const replacedAuth = authHeader.replace(
        /realm="https?:\/\/[^/"]+/g,
        `realm="${url.origin}`
      );
      newResponse.headers.set("Www-Authenticate", replacedAuth);
    }

    return newResponse;
  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, { status: 500 });
  }
}

function cleanHeaders(headers) {
  const h = new Headers(headers);
  h.delete("Host");
  h.delete("Origin");
  h.delete("Referer");
  if (!h.has("Accept")) {
    h.set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/json");
  }
  return h;
}
