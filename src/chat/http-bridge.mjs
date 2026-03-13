import { updateChatRuntime } from "./runtime.mjs";

export async function forwardChatSdkWebhook({ req, res, handler }) {
  try {
    updateChatRuntime({
      lastWebhookAt: new Date().toISOString(),
      lastWebhookStatus: req.method === "GET" ? "verification" : "received",
      lastError: null,
    });

    const request = buildFetchRequest(req);
    const response = await handler(request, {
      waitUntil: (task) => {
        task.catch((error) => {
          updateChatRuntime({
            lastWebhookStatus: "background-error",
            lastError: error?.message || "background-task-error",
          });
        });
      },
    });

    await writeFetchResponse(res, response);
  } catch (error) {
    updateChatRuntime({
      lastWebhookStatus: "bridge-error",
      lastError: error?.message || "bridge-error",
    });
    res.status(500).json({
      ok: false,
      error: "chat_webhook_bridge_error",
    });
  }
}

function buildFetchRequest(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const url = new URL(req.originalUrl || req.url || "/", origin).toString();
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      continue;
    }

    if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const requestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body)
        : Buffer.alloc(0);

    requestInit.body = rawBody;
  }

  return new Request(url, requestInit);
}

async function writeFetchResponse(res, response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") {
      return;
    }

    res.setHeader(key, value);
  });

  const bodyBuffer = Buffer.from(await response.arrayBuffer());
  if (bodyBuffer.length === 0) {
    res.end();
    return;
  }

  res.send(bodyBuffer);
}
