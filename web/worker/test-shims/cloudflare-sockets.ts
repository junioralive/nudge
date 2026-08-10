export function connect(): never {
  throw new Error("cloudflare:sockets is unavailable in Vitest; mock mail transport for integration tests");
}
