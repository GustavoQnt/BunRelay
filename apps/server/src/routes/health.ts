import { json } from "./utils.ts";

export function handleHealthRoute(request: Request, url: URL): Response | null {
  if (request.method !== "GET" || url.pathname !== "/health") {
    return null;
  }

  return json({
    ok: true,
    ts: Date.now()
  });
}

