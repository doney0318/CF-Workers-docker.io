// ========== 你自己配置 ==========
const USER = "doney";          // 用户名
const PASS = "dvub(tR6BO";  // 密码
const USE_AUTH = true;         // 是否开启密码验证
// ===============================

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

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

// 处理 /v2/ 根路径检查
async function handleV2Root(request) {
  const url = new URL(request.url);
  const targetUrl = new URL("https://registry-1.docker.io/v2/");
  
  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: cleanHeaders(request.headers),
    redirect: "follow"
  });

  const newResponse = new Response(response.body, response);
  
  // 替换认证头
  const authHeader = newResponse.headers.get("Www-Authenticate");
  if (authHeader) {
    newResponse.headers.set(
      "Www-Authenticate",
      authHeader.replace(/realm="[^"]*"/, `realm="${url.origin}/token"`)
    );
  }
  
  return newResponse;
}

async function proxyToken(request) {
  const url = new URL(request.url);
  
  // 根据 service 参数决定目标认证服务器
  const service = url.searchParams.get("service") || "registry.docker.io";
  let authServer = "auth.docker.io";
  
  // 映射不同的认证服务器
  if (service.includes("ghcr.io")) {
    authServer = "ghcr.io";
  } else if (service.includes("quay.io")) {
    authServer = "quay.io";
  } else if (service.includes("gcr.io")) {
    authServer = "gcr.io";
  } else if (service.includes("registry.k8s.io")) {
    authServer = "registry.k8s.io";
  }

  const targetUrl = new URL(`https://${authServer}${url.pathname}${url.search}`);

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: cleanHeaders(request.headers),
    body: request.body,
    redirect: "follow"
  });

  const newResponse = new Response(response.body, response);
  
  // 处理响应中的认证相关头部
  const authHeader = newResponse.headers.get("Www-Authenticate");
  if (authHeader) {
    // 替换 realm 为代理的 token 端点
    const replacedAuth = authHeader.replace(
      /realm="https?:\/\/[^/"]+/g,
      `realm="${url.origin}`
    );
    newResponse.headers.set("Www-Authenticate", replacedAuth);
  }

  return newResponse;
}

async function proxyRequest(request) {
  const url = new URL(request.url);
  let targetHost = "registry-1.docker.io";

  // 多仓库支持 - 改进的映射逻辑
  const hostMap = {
    "docker": "registry-1.docker.io",
    "ghcr": "ghcr.io",
    "quay": "quay.io",
    "gcr": "gcr.io",
    "k8s": "registry.k8s.io",
    "k8s-gcr": "k8s.gcr.io"
  };

  // 检查路径前缀或子域名
  const pathParts = url.pathname.split('/');
  if (pathParts.length > 2) {
    const prefix = pathParts[1];
    if (hostMap[prefix]) {
      targetHost = hostMap[prefix];
      // 重写路径，移除前缀
      url.pathname = url.pathname.replace(`/${prefix}`, '');
    }
  }

  // 子域名方式（保留向后兼容）
  const subdomain = url.hostname.split(".")[0];
  if (hostMap[subdomain] && !targetHost.includes(hostMap[subdomain])) {
    targetHost = hostMap[subdomain];
  }

  const targetUrl = new URL(`https://${targetHost}${url.pathname}${url.search}`);

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: cleanHeaders(request.headers),
    body: request.body,
    redirect: "follow"
  });

  const newResponse = new Response(response.body, response);
  
  // 处理认证头（如果 registry 直接返回）
  const authHeader = newResponse.headers.get("Www-Authenticate");
  if (authHeader) {
    const replacedAuth = authHeader.replace(
      /realm="https?:\/\/[^/"]+/g,
      `realm="${url.origin}`
    );
    newResponse.headers.set("Www-Authenticate", replacedAuth);
  }

  return newResponse;
}

function cleanHeaders(headers) {
  const h = new Headers(headers);
  // 删除可能引起问题的头部
  h.delete("Host");
  h.delete("Origin");
  h.delete("Referer");
  // 确保 Accept 头部包含 Docker 需要的类型
  if (!h.has("Accept")) {
    h.set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/json");
  }
  return h;
}
