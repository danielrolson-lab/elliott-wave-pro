export const config = { runtime: 'edge' };

export default function handler(): Response {
  return new Response(
    JSON.stringify({ status: 'ok', service: 'elliott-wave-pro-proxy', ts: Date.now() }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
