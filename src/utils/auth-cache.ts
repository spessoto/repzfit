/**
 * In-memory authentication cache.
 *
 * Avoids the 2 serial DB queries (auth.getUser + personals select) on every
 * request by caching the resolved personal profile for TTL_MS milliseconds.
 *
 * The cache is keyed by JWT token (first 64 chars used as key to save memory).
 * Entries are evicted lazily on the next request after TTL expires.
 *
 * Thread-safety: Node.js is single-threaded, so no lock is needed.
 */

import { supabaseAdmin } from "../config/supabase.js";
import type { FastifyInstance, FastifyRequest } from "fastify";

const TTL_MS = 60_000; // 60 seconds

interface CachedPersonal {
  personalId: string;
  personal: {
    id: string;
    name: string;
    email: string;
    evolution_instance_name: string | null;
  };
  expiresAt: number;
}

const cache = new Map<string, CachedPersonal>();

/** Returns a short cache key from a JWT (avoids storing full tokens in memory). */
function cacheKey(token: string): string {
  return token.slice(0, 64);
}

/** Evicts expired entries (called lazily). */
function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

/**
 * Extracts the Bearer token from the Authorization header.
 * Throws 401 if missing or malformed.
 */
export function extractBearerToken(
  app: FastifyInstance,
  request: FastifyRequest,
): string {
  const auth = request.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw app.httpErrors.unauthorized("Missing or invalid Authorization header");
  }
  return auth.slice(7);
}

/**
 * Validates the token and returns the resolved personal profile.
 * Results are cached for TTL_MS to avoid redundant DB round-trips.
 */
export async function getAuthenticatedPersonal(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{
  token: string;
  personalId: string;
  personal: CachedPersonal["personal"];
}> {
  const token = extractBearerToken(app, request);
  const key = cacheKey(token);

  evictExpired();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { token, personalId: cached.personalId, personal: cached.personal };
  }

  // Cache miss — hit the DB
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    throw app.httpErrors.unauthorized("Invalid or expired token");
  }

  const { data: personal, error: personalError } = await supabaseAdmin
    .from("personals")
    .select("id,name,email,evolution_instance_name")
    .eq("id", user.id)
    .maybeSingle();

  if (personalError) {
    throw app.httpErrors.internalServerError(personalError.message);
  }

  if (!personal) {
    throw app.httpErrors.notFound("Personal profile not found");
  }

  const entry: CachedPersonal = {
    personalId: user.id,
    personal: personal as CachedPersonal["personal"],
    expiresAt: Date.now() + TTL_MS,
  };

  cache.set(key, entry);

  return { token, personalId: user.id, personal: entry.personal };
}

/** Invalidates a specific token from the cache (e.g., after profile update). */
export function invalidateAuthCache(token: string): void {
  cache.delete(cacheKey(token));
}

/** Clears the entire cache (useful in tests). */
export function clearAuthCache(): void {
  cache.clear();
}
