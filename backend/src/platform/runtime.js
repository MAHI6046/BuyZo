function createPlatformRuntimeUtils({
  fetchImpl,
  redisRestUrl,
  redisRestToken,
  productsCacheGlobalVersionKey,
  productsCacheTtlSeconds,
  dotbotRateLimitWindowSeconds,
}) {
  const redisEnabled = redisRestUrl.length > 0 && redisRestToken.length > 0;
  const dotbotRateLimitMemory = new Map();

  function parseInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function countWords(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }

  function getRequestIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
    if (forwarded) {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    if (realIp) return realIp;
    return String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
  }

  function getDotbotRateLimitKey(req, scope) {
    const uid = String(req.auth?.uid || '').trim() || 'anonymous';
    const ip = getRequestIp(req);
    return `dotbot:ratelimit:${scope}:uid:${uid}:ip:${ip}`;
  }

  function cacheSegment(value, fallback = 'all') {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function categoryVersionKey(category) {
    return `products:version:category:${cacheSegment(category)}`;
  }

  function ordersVersionKey(firebaseUid) {
    return `orders:version:user:${cacheSegment(firebaseUid, 'anonymous')}`;
  }

  async function upstashCommand(command) {
    if (!redisEnabled) return null;
    const response = await fetchImpl(redisRestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisRestToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`Upstash command failed (${response.status})`);
    }
    const json = await response.json();
    if (json.error) {
      throw new Error(`Upstash command error: ${json.error}`);
    }
    return json.result;
  }

  async function consumeDotbotRateLimit({ key, limit, windowSeconds }) {
    const safeLimit = Math.max(1, Number(limit) || 1);
    const safeWindow = Math.max(1, Number(windowSeconds) || 60);

    if (redisEnabled) {
      const current = Number((await upstashCommand(['INCR', key])) || 0);
      if (current <= 1) {
        await upstashCommand(['EXPIRE', key, String(safeWindow)]);
      }
      const ttlRaw = Number((await upstashCommand(['TTL', key])) || safeWindow);
      const resetSeconds = ttlRaw > 0 ? ttlRaw : safeWindow;
      const remaining = Math.max(0, safeLimit - current);
      return {
        allowed: current <= safeLimit,
        current,
        remaining,
        limit: safeLimit,
        resetSeconds,
      };
    }

    const now = Date.now();
    const windowMs = safeWindow * 1000;
    const existing = dotbotRateLimitMemory.get(key);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + windowMs;
      dotbotRateLimitMemory.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        current: 1,
        remaining: Math.max(0, safeLimit - 1),
        limit: safeLimit,
        resetSeconds: safeWindow,
      };
    }

    existing.count += 1;
    const resetSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    const remaining = Math.max(0, safeLimit - existing.count);
    return {
      allowed: existing.count <= safeLimit,
      current: existing.count,
      remaining,
      limit: safeLimit,
      resetSeconds,
    };
  }

  function createDotbotRateLimitMiddleware(
    scope,
    limit,
    windowSeconds = dotbotRateLimitWindowSeconds,
  ) {
    return async function dotbotRateLimitMiddleware(req, res, next) {
      try {
        const key = getDotbotRateLimitKey(req, scope);
        const consumed = await consumeDotbotRateLimit({
          key,
          limit,
          windowSeconds,
        });

        res.setHeader('X-RateLimit-Limit', String(consumed.limit));
        res.setHeader('X-RateLimit-Remaining', String(consumed.remaining));
        res.setHeader('X-RateLimit-Reset', String(consumed.resetSeconds));

        if (!consumed.allowed) {
          res.setHeader('Retry-After', String(consumed.resetSeconds));
          return res.status(429).json({
            ok: false,
            message: 'Too many DOTBOT requests. Please wait and try again.',
            retry_after_seconds: consumed.resetSeconds,
          });
        }
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  function encodeCursor(createdAt, id, depth = 0) {
    if (!createdAt || !id) return null;
    const payload = JSON.stringify({
      createdAt: new Date(createdAt).toISOString(),
      id: Number(id),
      depth: Number.isFinite(depth) && depth >= 0 ? depth : 0,
    });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  function decodeCursor(cursor) {
    if (!cursor || typeof cursor !== 'string') return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const createdAt = new Date(parsed.createdAt);
      const id = Number(parsed.id);
      const depth = Number.parseInt(String(parsed.depth ?? 0), 10);
      if (!Number.isFinite(id) || Number.isNaN(createdAt.getTime())) {
        return null;
      }
      return {
        createdAt: createdAt.toISOString(),
        id,
        depth: Number.isFinite(depth) && depth >= 0 ? depth : 0,
      };
    } catch (_error) {
      return null;
    }
  }

  async function getJsonCache(key) {
    if (!redisEnabled) return null;
    try {
      const result = await upstashCommand(['GET', key]);
      if (!result) return null;
      return JSON.parse(result);
    } catch (error) {
      console.warn('Upstash GET cache failed:', error.message);
      return null;
    }
  }

  async function setJsonCache(key, value, ttlSeconds = productsCacheTtlSeconds) {
    if (!redisEnabled) return;
    try {
      await upstashCommand(['SETEX', key, String(ttlSeconds), JSON.stringify(value)]);
    } catch (error) {
      console.warn('Upstash SET cache failed:', error.message);
    }
  }

  async function getProductsCacheVersion({ category } = {}) {
    if (!redisEnabled) return '0';
    try {
      const [globalVersion, scopedCategoryVersion] = await Promise.all([
        upstashCommand(['GET', productsCacheGlobalVersionKey]),
        upstashCommand(['GET', categoryVersionKey(category)]),
      ]);
      return `${globalVersion || '0'}-${scopedCategoryVersion || '0'}`;
    } catch (error) {
      console.warn('Upstash version lookup failed:', error.message);
      return '0';
    }
  }

  async function bumpProductsCacheVersion({ category } = {}) {
    if (!redisEnabled) return;
    try {
      const commands = [['INCR', productsCacheGlobalVersionKey]];
      commands.push(['INCR', categoryVersionKey('all')]);
      if (category) {
        commands.push(['INCR', categoryVersionKey(category)]);
      }
      await Promise.all(commands.map((command) => upstashCommand(command)));
    } catch (error) {
      console.warn('Upstash version bump failed:', error.message);
    }
  }

  async function getOrdersCacheVersion(firebaseUid) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!redisEnabled || !normalizedUid) return '0';
    try {
      const version = await upstashCommand(['GET', ordersVersionKey(normalizedUid)]);
      return String(version || '0');
    } catch (error) {
      console.warn('Upstash orders version lookup failed:', error.message);
      return '0';
    }
  }

  async function bumpOrdersCacheVersion(firebaseUid) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!redisEnabled || !normalizedUid) return;
    try {
      await upstashCommand(['INCR', ordersVersionKey(normalizedUid)]);
    } catch (error) {
      console.warn('Upstash orders version bump failed:', error.message);
    }
  }

  return {
    parseInteger,
    clamp,
    countWords,
    createDotbotRateLimitMiddleware,
    encodeCursor,
    decodeCursor,
    cacheSegment,
    getJsonCache,
    setJsonCache,
    getProductsCacheVersion,
    bumpProductsCacheVersion,
    getOrdersCacheVersion,
    bumpOrdersCacheVersion,
  };
}

module.exports = { createPlatformRuntimeUtils };
