import { ZodError } from "zod";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export async function readJsonBody(
  request: Request,
  options?: { maxBytes?: number }
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const maxBytes = options?.maxBytes ?? 16_384;

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > maxBytes) {
      return {
        ok: false,
        response: json(
          {
            error: {
              code: "BAD_REQUEST",
              message: `payload too large (max ${maxBytes} bytes)`
            }
          },
          413
        )
      };
    }

    const text = new TextDecoder().decode(body);
    if (!text.trim()) {
      return {
        ok: false,
        response: json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "empty body"
            }
          },
          400
        )
      };
    }

    return { ok: true, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "invalid JSON body"
          }
        },
        400
      )
    };
  }
}

export function zodToResponse(error: ZodError, refId?: string): Response {
  return json(
    {
      error: {
        code: "BAD_REQUEST",
        message: "invalid payload",
        details: error.issues,
        refId
      }
    },
    400
  );
}

export function authError(status = 401): Response {
  return json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "unauthorized"
      }
    },
    status
  );
}
