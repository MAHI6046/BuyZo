const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const { pool } = require('./db');

const DEFAULT_LLM_MODEL = 'gpt-4o-mini';
const DEFAULT_STT_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_TTS_MODEL = 'tts-1';
const DEFAULT_TTS_VOICE = 'alloy';
const DEFAULT_MATCH_LIMIT = 3;
const DEFAULT_DISTANCE_THRESHOLD = 0.4;
const DEFAULT_SUGGESTION_LIMIT = 5;
const SIZE_VALUE_TOLERANCE_RATIO = 0.05;
const SIZE_VALUE_TOLERANCE_MIN = 2;

let openaiClient = null;

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatEnv(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isDotBotEnabled() {
  return parseBooleanEnv(process.env.DOTBOT_ENABLED, true);
}

function getOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('DOTBOT requires OPENAI_API_KEY');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getDotBotLlmModel() {
  return String(process.env.DOTBOT_LLM_MODEL || DEFAULT_LLM_MODEL).trim();
}

function getDotBotSttModel() {
  return String(process.env.DOTBOT_STT_MODEL || DEFAULT_STT_MODEL).trim();
}

function getDotBotSttLanguage() {
  return String(process.env.DOTBOT_STT_LANGUAGE || 'en').trim();
}

function getDotBotSttFallbackModels() {
  const configured = String(process.env.DOTBOT_STT_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return ['whisper-1'];
}

function getDotBotTtsModel() {
  return String(process.env.DOTBOT_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
}

function getDotBotTtsFallbackModels() {
  const configured = String(process.env.DOTBOT_TTS_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return ['gpt-4o-mini-tts'];
}

function getDotBotTtsVoice() {
  return String(process.env.DOTBOT_TTS_VOICE || DEFAULT_TTS_VOICE).trim();
}

function getEmbeddingModel() {
  return String(
    process.env.DOTBOT_EMBEDDING_MODEL ||
      process.env.OPENAI_EMBEDDING_MODEL ||
      'text-embedding-3-small',
  ).trim();
}

function getMatchLimit() {
  return parseIntegerEnv(process.env.DOTBOT_MATCH_LIMIT, DEFAULT_MATCH_LIMIT);
}

function getDistanceThreshold() {
  return parseFloatEnv(
    process.env.DOTBOT_MATCH_DISTANCE_THRESHOLD,
    DEFAULT_DISTANCE_THRESHOLD,
  );
}

function getSuggestionLimit() {
  return parseIntegerEnv(process.env.DOTBOT_SUGGESTION_LIMIT, DEFAULT_SUGGESTION_LIMIT);
}

function normalizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];
  return conversation
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const role = String(item.role || '').trim().toLowerCase();
      const content = String(item.content || '').trim();
      if (!content) return null;
      if (role !== 'assistant') {
        return { role: 'user', content };
      }
      return { role: 'assistant', content };
    })
    .filter(Boolean)
    .slice(-12);
}

function normalizeCartItems(cartItems) {
  if (!Array.isArray(cartItems)) return [];
  return cartItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);
      const name = String(item.name || '').trim();
      const sizeLabel = String(item.size_label || '').trim();
      if (!Number.isFinite(productId) || productId <= 0) return null;
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      return {
        product_id: productId,
        quantity: Math.round(quantity),
        name: name || `Product ${productId}`,
        size_label: sizeLabel,
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

function parseJsonFromModel(rawContent) {
  const text = String(rawContent || '').trim();
  if (!text) {
    throw new Error('DOTBOT model returned empty response');
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      return JSON.parse(fenced[1]);
    }
    throw new Error('DOTBOT model returned invalid JSON');
  }
}

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding vector is empty');
  }
  const values = embedding.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('Embedding contains non-numeric values');
    }
    return String(numeric);
  });
  return `[${values.join(',')}]`;
}

function normalizeDetectedItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const query = cleanDetectedQuery(String(item.query || item.name || '').trim());
      const qty = Number(item.quantity);
      if (!query) return null;
      return {
        query,
        quantity: Number.isFinite(qty) && qty > 0 ? Math.min(20, Math.round(qty)) : 1,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function cleanDetectedQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return '';
  const normalized = raw
    .replace(/["']/g, ' ')
    .replace(/\b(add|to|cart|my|please|pls|the|a|an|item|items)\b/gi, ' ')
    .replace(/\b(any|random|brand|one|some)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || raw;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[left.length][right.length];
}

function similarityRatio(a, b) {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLen = Math.max(left.length, right.length);
  if (maxLen <= 0) return 0;
  const distance = levenshteinDistance(left, right);
  return Math.max(0, 1 - distance / maxLen);
}

function tokenizeNormalized(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length > 1);
}

function normalizeQueryForNameMatch(query) {
  return normalizeSearchText(query)
    .replace(
      /\b\d+(?:\.\d+)?\s*(kg|kgs?|kilograms?|g|gm|grams?|gram|mg|ml|l|lt|ltr|lit(?:er|re)?s?|oz|ounces?|lb|lbs?|pounds?|pcs?|pieces?|pack|packs)\b/g,
      ' ',
    )
    .replace(/\b(size|gram|grams|kg|ml|litre|liter|pack|packs|pcs|piece)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenCoverageScore(query, candidateName) {
  const queryTokens = tokenizeNormalized(query);
  const candidateTokens = tokenizeNormalized(candidateName);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  let matched = 0;
  for (const token of queryTokens) {
    const bestTokenSimilarity = candidateTokens.reduce(
      (best, candidateToken) =>
        Math.max(best, similarityRatio(token, candidateToken)),
      0,
    );
    if (bestTokenSimilarity >= 0.84) {
      matched += 1;
    }
  }
  return matched / queryTokens.length;
}

function candidateNameConfidence(query, candidate) {
  const name = String(candidate?.name || '').trim();
  if (!name) return 0;
  const normalizedQuery = normalizeQueryForNameMatch(query);
  const fullSimilarity = similarityRatio(normalizedQuery, name);
  const tokenCoverage = tokenCoverageScore(normalizedQuery, name);
  const lexicalBonus = Math.min(0.1, Math.max(0, Number(candidate?.lexical_score || 0) / 1000));
  return fullSimilarity * 0.4 + tokenCoverage * 0.6 + lexicalBonus;
}

function pickCoverageDominantCandidate(query, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const normalizedQuery = normalizeQueryForNameMatch(query);
  if (!normalizedQuery) return null;

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      coverage: tokenCoverageScore(normalizedQuery, candidate?.name || ''),
      confidence: candidateNameConfidence(query, candidate),
    }))
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const lexicalDiff =
        Number(b.candidate?.lexical_score || 0) - Number(a.candidate?.lexical_score || 0);
      if (lexicalDiff !== 0) return lexicalDiff;
      return Number(b.candidate?.stock_qty || 0) - Number(a.candidate?.stock_qty || 0);
    });

  const top = ranked[0];
  const second = ranked[1] || null;
  if (!top) return null;
  const coverageGap = top.coverage - Number(second?.coverage || 0);
  if (top.coverage >= 0.99 && coverageGap >= 0.1) return top.candidate;
  if (top.coverage >= 0.9 && coverageGap >= 0.18) return top.candidate;
  if (top.coverage >= 0.8 && coverageGap >= 0.28) return top.candidate;
  return null;
}

function bestCandidateByNameConfidence(query, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidate: null, confidence: 0 };
  }
  let best = null;
  let bestConfidence = 0;
  for (const candidate of candidates) {
    const confidence = candidateNameConfidence(query, candidate);
    if (!best || confidence > bestConfidence) {
      best = candidate;
      bestConfidence = confidence;
    }
  }
  return {
    candidate: best,
    confidence: best ? bestConfidence : 0,
  };
}

function pickConfidentLexicalCandidate(query, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      confidence: candidateNameConfidence(query, candidate),
    }))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const lexicalDiff = Number(b.candidate.lexical_score || 0) - Number(a.candidate.lexical_score || 0);
      if (lexicalDiff !== 0) return lexicalDiff;
      return Number(b.candidate.stock_qty || 0) - Number(a.candidate.stock_qty || 0);
    });
  const top = ranked[0];
  const second = ranked[1] || null;
  if (!top) return null;
  const topName = normalizeSearchText(top.candidate?.name || '');
  const secondName = normalizeSearchText(second?.candidate?.name || '');
  const sameNameCandidates = ranked
    .filter((entry) => normalizeSearchText(entry.candidate?.name || '') === topName)
    .map((entry) => entry.candidate);
  if (topName && secondName && topName === secondName) {
    return pickLargestSizeCandidate(sameNameCandidates) || top.candidate;
  }
  const margin = top.confidence - Number(second?.confidence || 0);
  const largestSameName = pickLargestSizeCandidate(sameNameCandidates);
  if (top.confidence >= 0.9) return top.candidate;
  if (top.confidence >= 0.8 && margin >= 0.05) return largestSameName || top.candidate;
  if (top.confidence >= 0.7 && (margin >= 0.03 || !second)) {
    return largestSameName || top.candidate;
  }
  return null;
}

function formatVariantTitle(row) {
  const label = String(row?.label || '').trim();
  if (label) return label;
  const grams = Number(row?.grams);
  if (Number.isFinite(grams) && grams > 0) return `${Math.round(grams)} g`;
  const sizeCode = String(row?.size_code || '').trim();
  if (sizeCode) return sizeCode;
  return '';
}

async function loadVariantsByProductIds(productIds) {
  const ids = Array.from(
    new Set((productIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (ids.length === 0) return new Map();

  const result = await pool.query(
    `
    SELECT
      pv.product_id,
      pv.id,
      pv.label,
      pv.grams,
      pv.size_code,
      pv.mrp,
      pv.sale_price,
      pv.stock_qty,
      pv.is_default
    FROM product_variants pv
    WHERE pv.product_id = ANY($1::bigint[])
      AND COALESCE(pv.stock_qty, 0) > 0
    ORDER BY pv.product_id ASC, COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.id ASC
    `,
    [ids],
  );

  const byProduct = new Map();
  for (const row of result.rows) {
    const productId = Number(row.product_id);
    if (!byProduct.has(productId)) {
      byProduct.set(productId, []);
    }
    byProduct.get(productId).push({
      id: Number(row.id),
      label: String(row.label || ''),
      grams: Number.isFinite(Number(row.grams)) ? Number(row.grams) : 0,
      size_code: String(row.size_code || ''),
      mrp: Number.isFinite(Number(row.mrp)) ? Number(row.mrp) : 0,
      sale_price: Number.isFinite(Number(row.sale_price)) ? Number(row.sale_price) : 0,
      stock_qty: Number.isFinite(Number(row.stock_qty)) ? Number(row.stock_qty) : 0,
      is_default: row.is_default === true,
      title: formatVariantTitle(row),
    });
  }
  return byProduct;
}

function pickLargestVariantOption(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const ranked = [...variants].sort((a, b) => {
    const gramsA = Number.isFinite(Number(a?.grams)) ? Number(a.grams) : 0;
    const gramsB = Number.isFinite(Number(b?.grams)) ? Number(b.grams) : 0;
    if (gramsB !== gramsA) return gramsB - gramsA;
    const priceA = Number.isFinite(Number(a?.sale_price)) ? Number(a.sale_price) : 0;
    const priceB = Number.isFinite(Number(b?.sale_price)) ? Number(b.sale_price) : 0;
    if (priceB !== priceA) return priceB - priceA;
    if (a?.is_default === true && b?.is_default !== true) return -1;
    if (b?.is_default === true && a?.is_default !== true) return 1;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });
  return ranked[0] || null;
}

async function enrichActionsWithVariants(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return actions;
  const productIds = actions
    .map((action) => Number(action?.product_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (productIds.length === 0) return actions;

  const variantsByProduct = await loadVariantsByProductIds(productIds);
  return actions.map((action) => {
    if (!action || typeof action !== 'object') return action;
    const productId = Number(action.product_id);
    const variants = variantsByProduct.get(productId) || [];
    if (!action.product || typeof action.product !== 'object') {
      return action;
    }

    const nextProduct = { ...action.product };
    nextProduct.variants = variants;
    const largestVariant = pickLargestVariantOption(variants);
    if (largestVariant) {
      if (String(action.type || '').toLowerCase() === 'add_to_cart') {
        nextProduct.size_label = String(largestVariant.title || '').trim();
        const largestSalePrice = Number(largestVariant.sale_price);
        if (Number.isFinite(largestSalePrice) && largestSalePrice > 0) {
          nextProduct.price_sale = largestSalePrice;
        }
      } else if (!nextProduct.size_label || String(nextProduct.size_label).trim() === '') {
        nextProduct.size_label = String(largestVariant.title || '').trim();
      }

      if (!Number.isFinite(Number(nextProduct.price_sale)) || Number(nextProduct.price_sale) <= 0) {
        const fallbackPrice = Number(largestVariant.sale_price);
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
          nextProduct.price_sale = fallbackPrice;
        }
      }
    }

    return {
      ...action,
      product: nextProduct,
    };
  });
}

function extractLeadingQuantity(value, fallback = 1) {
  const raw = String(value || '').trim();
  if (!raw) return { text: '', quantity: fallback };
  const match = raw.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) {
    return { text: raw, quantity: fallback };
  }
  const quantity = Number.parseInt(match[1], 10);
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? Math.min(20, quantity) : fallback;
  return {
    text: String(match[2] || '').trim(),
    quantity: safeQty,
  };
}

function extractDirectCommand(message) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const normalized = normalizeSearchText(raw);
  if (!normalized) return null;

  const addMatch = normalized.match(
    /^(?:please\s+)?(?:add|put|include|get|buy)\s+(.+?)(?:\s+to\s+(?:my\s+)?cart)?$/,
  );
  if (addMatch && addMatch[1]) {
    const parsed = extractLeadingQuantity(addMatch[1], 1);
    const query = cleanDetectedQuery(parsed.text);
    if (!query) return null;
    return {
      intent: 'add_to_cart',
      items: [{ query, quantity: parsed.quantity }],
    };
  }

  const removeMatch = normalized.match(
    /^(?:please\s+)?(?:remove|delete|take\s+out|takeoff|take\s+off)\s+(.+?)(?:\s+from\s+(?:my\s+)?cart)?$/,
  );
  if (removeMatch && removeMatch[1]) {
    const parsed = extractLeadingQuantity(removeMatch[1], 1);
    const query = cleanDetectedQuery(parsed.text) || String(parsed.text || '').trim();
    if (!query) return null;
    return {
      intent: 'remove_from_cart',
      items: [{ query, quantity: parsed.quantity }],
    };
  }

  return null;
}

function isPronounOnlyQuery(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return false;
  return /^(it|that|this|same|same one|same item)$/.test(normalized);
}

function shouldRemoveAll(message) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return false;
  return /\b(remove all|delete all|clear|entire|whole)\b/.test(normalized);
}

function shouldRequireExactSize(message) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return false;
  return /\b(only|exact|exactly|must|strict|no substitute|dont substitute|don t substitute)\b/.test(
    normalized,
  );
}

function shouldTreatAsRepeatClarification(message) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return false;
  if (!/\badd\b/.test(normalized)) return false;
  if (/\b(another|again|more|extra|2|two|3|three|4|four)\b/.test(normalized)) return false;
  return true;
}

function extractMentionedSizeText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const numeric = raw.match(
    /\b\d+(?:\.\d+)?\s*(?:kg|kgs?|kilograms?|g|gm|grams?|gram|mg|ml|l|lt|ltr|lit(?:er|re)?s?|oz|ounces?|lb|lbs?|pounds?)\b/i,
  );
  if (numeric && numeric[0]) {
    return String(numeric[0]).trim();
  }
  const counted = raw.match(/\b\d+(?:\.\d+)?\s*(?:pcs?|pieces?|pack|packs)\b/i);
  if (counted && counted[0]) {
    return String(counted[0]).trim();
  }
  const coded = raw.match(/\b(?:xxl|xl|large|big|medium|med|small|mini|jumbo)\b/i);
  if (coded && coded[0]) {
    return String(coded[0]).trim();
  }
  return '';
}

function isSizeCorrectionMessage(message) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return false;
  if (!/\b(i said|i mean|meant|should be|not|instead|wrong)\b/.test(normalized)) {
    return false;
  }
  return extractMentionedSizeText(message).length > 0;
}

function selectLexicalCandidate(query, candidates) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 1);

  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const haystack = normalizeSearchText(
      `${candidate?.name || ''} ${candidate?.brand || ''} ${candidate?.category || ''}`,
    );
    if (!haystack) continue;

    let score = 0;
    if (haystack.includes(normalizedQuery)) {
      score += 100;
    }
    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += 10;
      }
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function looksLikeSelectionFollowup(message) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return false;
  const words = normalized.split(' ').filter(Boolean);
  if (words.length > 4) return false;
  if (/^\d+$/.test(normalized)) return true;
  return /\b(yes|no|cancel|option|first|second|third|fourth|fifth|this|that)\b/.test(
    normalized,
  );
}

function shouldAutoPickAny(...values) {
  const normalized = normalizeSearchText(values.filter(Boolean).join(' '));
  if (!normalized) return false;
  return /\b(any|random|whichever|whatever|anyone|any one|any brand|no preference)\b/.test(
    normalized,
  );
}

function pickRandomCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] || null;
}

function getQueryVariants(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const variants = new Set([normalized]);

  const synonyms = {
    daal: ['dal', 'lentil', 'lentils', 'pulse', 'pulses'],
    dal: ['daal', 'lentil', 'lentils', 'pulse', 'pulses'],
  };

  for (const token of normalized.split(' ')) {
    const mapped = synonyms[token];
    if (!mapped) continue;
    for (const alt of mapped) {
      variants.add(alt);
    }
  }

  const tokens = normalized.split(' ').filter((token) => token.length >= 3);
  for (const token of tokens.slice(0, 8)) {
    variants.add(token);
  }

  // Add short phrases to recover from minor typos inside full query strings.
  for (let i = 0; i < tokens.length; i += 1) {
    const twoGram = tokens.slice(i, i + 2).join(' ').trim();
    const threeGram = tokens.slice(i, i + 3).join(' ').trim();
    if (twoGram.split(' ').length >= 2) variants.add(twoGram);
    if (threeGram.split(' ').length >= 2) variants.add(threeGram);
  }

  return Array.from(variants).filter(Boolean);
}

function parseNumericSizeDescriptor(value) {
  const source = String(value || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return null;

  const numericMatch = source.match(
    /\b(\d+(?:\.\d+)?)\s*(kg|kgs?|kilograms?|g|gm|grams?|gram|mg|ml|l|lt|ltr|lit(?:er|re)?s?|oz|ounces?|lb|lbs?|pounds?)\b/i,
  );
  if (!numericMatch) return null;

  const amount = Number.parseFloat(numericMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = String(numericMatch[2] || '').toLowerCase();

  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(unit)) {
    return { kind: 'weight', value: amount * 1000 };
  }
  if (['g', 'gm', 'gram', 'grams'].includes(unit)) {
    return { kind: 'weight', value: amount };
  }
  if (unit === 'mg') {
    return { kind: 'weight', value: amount / 1000 };
  }
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) {
    return { kind: 'weight', value: amount * 453.59237 };
  }
  if (['oz', 'ounce', 'ounces'].includes(unit)) {
    return { kind: 'weight', value: amount * 28.349523125 };
  }
  if (['l', 'lt', 'ltr', 'liter', 'liters', 'litre', 'litres'].includes(unit)) {
    return { kind: 'volume', value: amount * 1000 };
  }
  if (unit === 'ml') {
    return { kind: 'volume', value: amount };
  }
  return null;
}

function parseCountSizeDescriptor(value) {
  const source = String(value || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return null;
  const countMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(pcs?|pieces?|pack|packs)\b/i);
  if (!countMatch) return null;
  const amount = Number.parseFloat(countMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { kind: 'count', value: amount };
}

function normalizeSizeCodeToken(value) {
  const token = String(value || '').toLowerCase().trim();
  if (!token) return '';
  if (token === 'big') return 'large';
  if (token === 'med') return 'medium';
  return token;
}

function parseSizeCodeDescriptor(value) {
  const source = String(value || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return null;
  const match = source.match(/\b(xxl|xl|large|big|medium|med|small|mini|jumbo)\b/i);
  if (!match) return null;
  const code = normalizeSizeCodeToken(match[1]);
  if (!code) return null;
  return { kind: 'size_code', code };
}

function parseSizeDescriptor(value) {
  return (
    parseNumericSizeDescriptor(value) ||
    parseCountSizeDescriptor(value) ||
    parseSizeCodeDescriptor(value)
  );
}

function getRequestedSizeDescriptor(itemQuery, fullMessage, fallbackAllowed = false) {
  const fromItem = parseSizeDescriptor(itemQuery);
  if (fromItem) return fromItem;
  if (!fallbackAllowed) return null;
  return parseSizeDescriptor(fullMessage);
}

function getCandidateSizeDescriptor(candidate) {
  const sizeLabel = inferProductSizeLabel(candidate);
  const combined = `${sizeLabel} ${candidate?.name || ''} ${candidate?.short_description || ''}`;
  return parseSizeDescriptor(combined);
}

function sizeDescriptorMatches(requested, candidate) {
  if (!requested) return true;
  if (!candidate) return false;
  if (requested.kind !== candidate.kind) return false;
  if (requested.kind === 'size_code') {
    return requested.code === candidate.code;
  }

  const requestedValue = Number(requested.value);
  const candidateValue = Number(candidate.value);
  if (!Number.isFinite(requestedValue) || !Number.isFinite(candidateValue)) return false;
  const tolerance = Math.max(
    SIZE_VALUE_TOLERANCE_MIN,
    requestedValue * SIZE_VALUE_TOLERANCE_RATIO,
  );
  return Math.abs(candidateValue - requestedValue) <= tolerance;
}

function filterCandidatesBySize(candidates, requestedSize) {
  if (!requestedSize || !Array.isArray(candidates) || candidates.length === 0) {
    return Array.isArray(candidates) ? candidates : [];
  }
  return candidates.filter((candidate) =>
    sizeDescriptorMatches(requestedSize, getCandidateSizeDescriptor(candidate)),
  );
}

function normalizeProductFamilyName(value) {
  return normalizeSearchText(value)
    .replace(
      /\b\d+(?:\.\d+)?\s*(kg|kgs?|kilograms?|g|gm|grams?|gram|mg|ml|l|lt|ltr|lit(?:er|re)?s?|oz|ounces?|lb|lbs?|pounds?|pcs?|pieces?|pack|packs)\b/g,
      ' ',
    )
    .replace(/\b(xxl|xl|large|big|medium|med|small|mini|jumbo|size)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canAutoPickLargestSize(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return false;
  const familyNames = new Set(
    candidates
      .map((candidate) => normalizeProductFamilyName(candidate?.name || ''))
      .filter(Boolean),
  );
  if (familyNames.size !== 1) return false;

  const numericSizeCount = candidates.filter((candidate) => {
    const descriptor = getCandidateSizeDescriptor(candidate);
    return descriptor && descriptor.kind !== 'size_code' && Number.isFinite(Number(descriptor.value));
  }).length;
  return numericSizeCount >= 2;
}

function pickLargestSizeCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const enriched = candidates
    .map((candidate) => {
      const descriptor = getCandidateSizeDescriptor(candidate);
      if (!descriptor || descriptor.kind === 'size_code') return null;
      const sizeValue = Number(descriptor.value);
      if (!Number.isFinite(sizeValue)) return null;
      return { candidate, sizeValue, descriptorKind: descriptor.kind };
    })
    .filter(Boolean);
  if (enriched.length === 0) return null;

  const kindCounts = new Map();
  for (const entry of enriched) {
    const count = Number(kindCounts.get(entry.descriptorKind) || 0);
    kindCounts.set(entry.descriptorKind, count + 1);
  }
  const dominantKind =
    [...kindCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || enriched[0].descriptorKind;
  const sameKind = enriched.filter((entry) => entry.descriptorKind === dominantKind);
  if (sameKind.length === 0) return null;

  sameKind.sort((a, b) => {
    if (b.sizeValue !== a.sizeValue) return b.sizeValue - a.sizeValue;
    const lexicalDiff = Number(b.candidate.lexical_score || 0) - Number(a.candidate.lexical_score || 0);
    if (lexicalDiff !== 0) return lexicalDiff;
    const stockDiff = Number(b.candidate.stock_qty || 0) - Number(a.candidate.stock_qty || 0);
    if (stockDiff !== 0) return stockDiff;
    return Number(b.candidate.price_sale || 0) - Number(a.candidate.price_sale || 0);
  });
  return sameKind[0]?.candidate || null;
}

function clampQuantity(requested, maxStock) {
  const safeRequested = Number.isFinite(Number(requested))
    ? Math.max(1, Math.round(Number(requested)))
    : 1;
  const safeMax = Number(maxStock);
  if (!Number.isFinite(safeMax) || safeMax <= 0) return safeRequested;
  return Math.min(safeRequested, Math.max(1, Math.round(safeMax)));
}

function normalizeAudioBase64Input(value) {
  const encoded = String(value || '').trim();
  if (!encoded) return '';
  const dataUriMatch = encoded.match(/^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataUriMatch && dataUriMatch[1]) {
    return dataUriMatch[1].trim();
  }
  return encoded;
}

function resolveAudioMimeMeta(mimeType) {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized.includes('wav')) {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return { extension: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (normalized.includes('webm')) {
    return { extension: 'webm', mimeType: 'audio/webm' };
  }
  if (normalized.includes('ogg') || normalized.includes('opus')) {
    return { extension: 'ogg', mimeType: 'audio/ogg' };
  }
  if (
    normalized.includes('m4a') ||
    normalized.includes('mp4') ||
    normalized.includes('aac')
  ) {
    return { extension: 'm4a', mimeType: 'audio/mp4' };
  }
  return { extension: 'm4a', mimeType: 'audio/mp4' };
}

function shouldRetryWithFallbackModel(error) {
  const status = Number(error?.status);
  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('model') ||
    message.includes('unsupported') ||
    message.includes('not found') ||
    message.includes('does not exist')
  ) {
    return true;
  }
  if (Number.isFinite(status) && status >= 500) return true;
  return false;
}

function mapProductForDotbot(row) {
  const priceMrp = Number(row.price_mrp);
  const priceSale = Number(row.price_sale);
  const discountPercent =
    priceMrp > 0 ? Math.max(0, Math.round(((priceMrp - priceSale) / priceMrp) * 10000) / 100) : 0;
  const sizeLabel = inferProductSizeLabel(row);

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    short_description: String(row.short_description || ''),
    description: String(row.description || ''),
    price_mrp: Number.isFinite(priceMrp) ? priceMrp : 0,
    price_sale: Number.isFinite(priceSale) ? priceSale : 0,
    discount_percent: discountPercent,
    stock_qty: Number.isFinite(Number(row.stock_qty)) ? Number(row.stock_qty) : 0,
    is_veg: row.is_veg === null || row.is_veg === undefined ? null : row.is_veg === true,
    category: String(row.category || ''),
    brand: String(row.brand || ''),
    size_label: sizeLabel,
    primary_image_url: String(row.primary_image_url || ''),
    images: [],
    highlights: [],
    nutrition: [],
    variants: [],
    similar: [],
  };
}

function inferProductSizeLabel(row) {
  const explicitSize = String(row?.size_label || row?.size || '').trim();
  if (explicitSize) return explicitSize;

  const variantLabel = String(row?.variant_label || '').trim();
  if (variantLabel) return variantLabel;

  const variantGrams = Number(row?.variant_grams);
  if (Number.isFinite(variantGrams) && variantGrams > 0) {
    return `${Math.round(variantGrams)} g`;
  }

  const sizeCode = String(row?.variant_size_code || '').trim();
  if (sizeCode) return sizeCode;

  const source = `${row?.name || ''} ${row?.short_description || ''} ${row?.description || ''}`;
  const compactMatch = source.match(
    /\b(\d+(?:\.\d+)?)\s?(kg|g|gm|grams?|ml|l|lit(?:er|re)?|oz|lb|pcs?|pack)\b/i,
  );
  if (compactMatch) {
    const amount = compactMatch[1];
    let unit = compactMatch[2].toLowerCase();
    if (unit === 'gm' || unit === 'grams' || unit === 'gram') unit = 'g';
    if (unit === 'liter' || unit === 'litre') unit = 'L';
    if (unit === 'l') unit = 'L';
    return `${amount} ${unit}`;
  }

  return '';
}

async function createEmbedding(text) {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: getEmbeddingModel(),
    input: text,
  });
  const embedding = response?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('OpenAI embeddings returned empty vector');
  }
  return embedding;
}

async function detectIntent({
  message,
  conversation,
  cartItems,
}) {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDotBotLlmModel(),
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are DOTBOT intent detector for grocery shopping assistant. ' +
          'Return strict JSON with keys: intent, conversation_end, items, reply_goal. ' +
          'intent must be one of add_to_cart, remove_from_cart, smalltalk, checkout, unknown. ' +
          'conversation_end must be boolean. ' +
          'items must be array of objects: {query, quantity}. quantity integer >=1. ' +
          'Only include items user asked to add/remove now. No extra keys.',
      },
      ...conversation,
      {
        role: 'user',
        content: JSON.stringify({
          message,
          cart_items: cartItems,
        }),
      },
    ],
  });

  const raw = completion?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonFromModel(raw);
  const rawIntent = String(parsed.intent || '').trim().toLowerCase();
  const intent = ['add_to_cart', 'remove_from_cart', 'smalltalk', 'checkout', 'unknown'].includes(rawIntent)
    ? rawIntent
    : 'unknown';
  const conversationEnd = parsed.conversation_end === true;
  const items = normalizeDetectedItems(parsed.items);
  const replyGoal = String(parsed.reply_goal || '').trim();

  return {
    intent,
    conversationEnd,
    items,
    replyGoal,
  };
}

async function searchProductCandidates(query) {
  const embedding = await createEmbedding(query);
  const vectorLiteral = toVectorLiteral(embedding);

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.short_description,
      p.description,
      p.category,
      p.brand,
      p.is_veg,
      p.price_mrp,
      p.price_sale,
      p.stock_qty,
      p.primary_image_url,
      pv.variant_label,
      pv.variant_grams,
      pv.variant_size_code,
      (pe.embedding <=> $1::vector) AS distance
    FROM product_embeddings pe
    JOIN products p ON p.id = pe.product_id
    LEFT JOIN LATERAL (
      SELECT
        label AS variant_label,
        grams AS variant_grams,
        size_code AS variant_size_code
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND COALESCE(pv.stock_qty, 0) > 0
      ORDER BY COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.stock_qty DESC, pv.id ASC
      LIMIT 1
    ) pv ON TRUE
    WHERE p.is_active = TRUE
      AND COALESCE(p.stock_qty, 0) > 0
    ORDER BY pe.embedding <=> $1::vector ASC
    LIMIT $2
    `,
    [vectorLiteral, getMatchLimit()],
  );

  return result.rows.map((row) => ({
    ...row,
    distance: Number(row.distance),
  }));
}

async function searchSemanticCandidates(query, limit) {
  const embedding = await createEmbedding(query);
  const vectorLiteral = toVectorLiteral(embedding);

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.short_description,
      p.description,
      p.category,
      p.brand,
      p.is_veg,
      p.price_mrp,
      p.price_sale,
      p.stock_qty,
      p.primary_image_url,
      pv.variant_label,
      pv.variant_grams,
      pv.variant_size_code,
      (pe.embedding <=> $1::vector) AS distance
    FROM product_embeddings pe
    JOIN products p ON p.id = pe.product_id
    LEFT JOIN LATERAL (
      SELECT
        label AS variant_label,
        grams AS variant_grams,
        size_code AS variant_size_code
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND COALESCE(pv.stock_qty, 0) > 0
      ORDER BY COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.stock_qty DESC, pv.id ASC
      LIMIT 1
    ) pv ON TRUE
    WHERE p.is_active = TRUE
      AND COALESCE(p.stock_qty, 0) > 0
    ORDER BY pe.embedding <=> $1::vector ASC
    LIMIT $2
    `,
    [vectorLiteral, limit],
  );

  return result.rows.map((row) => ({
    ...row,
    distance: Number(row.distance),
  }));
}

async function fallbackProductCandidates(query) {
  const result = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.short_description,
      p.description,
      p.category,
      p.brand,
      p.is_veg,
      p.price_mrp,
      p.price_sale,
      p.stock_qty,
      p.primary_image_url,
      pv.variant_label,
      pv.variant_grams,
      pv.variant_size_code
    FROM products p
    LEFT JOIN LATERAL (
      SELECT
        label AS variant_label,
        grams AS variant_grams,
        size_code AS variant_size_code
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND COALESCE(pv.stock_qty, 0) > 0
      ORDER BY COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.stock_qty DESC, pv.id ASC
      LIMIT 1
    ) pv ON TRUE
    WHERE p.is_active = TRUE
      AND COALESCE(p.stock_qty, 0) > 0
      AND (
        LOWER(p.name) LIKE LOWER($1)
        OR LOWER(COALESCE(p.brand, '')) LIKE LOWER($1)
        OR LOWER(COALESCE(p.category, '')) LIKE LOWER($1)
      )
    ORDER BY p.stock_qty DESC, p.id DESC
    LIMIT 3
    `,
    [`%${query}%`],
  );
  return result.rows.map((row) => ({
    ...row,
    distance: null,
  }));
}

async function searchLexicalCandidates(query, limit) {
  const variants = getQueryVariants(query);
  if (variants.length === 0) return [];

  const collected = new Map();
  for (const variant of variants.slice(0, 4)) {
    const wildcard = `%${variant}%`;
    const prefix = `${variant}%`;
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.short_description,
        p.description,
        p.category,
        p.brand,
        p.is_veg,
        p.price_mrp,
        p.price_sale,
        p.stock_qty,
        p.primary_image_url,
        pv.variant_label,
        pv.variant_grams,
        pv.variant_size_code,
        CASE
          WHEN LOWER(p.name) = LOWER($1) THEN 300
          WHEN LOWER(p.name) LIKE LOWER($2) THEN 220
          WHEN LOWER(p.name) LIKE LOWER($3) THEN 180
          WHEN LOWER(COALESCE(p.category, '')) LIKE LOWER($3) THEN 120
          WHEN LOWER(COALESCE(p.brand, '')) LIKE LOWER($3) THEN 110
          WHEN LOWER(COALESCE(p.short_description, '')) LIKE LOWER($3) THEN 80
          ELSE 0
        END AS lexical_score
      FROM products p
      LEFT JOIN LATERAL (
        SELECT
          label AS variant_label,
          grams AS variant_grams,
          size_code AS variant_size_code
        FROM product_variants pv
        WHERE pv.product_id = p.id
          AND COALESCE(pv.stock_qty, 0) > 0
        ORDER BY COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.stock_qty DESC, pv.id ASC
        LIMIT 1
      ) pv ON TRUE
      WHERE p.is_active = TRUE
        AND COALESCE(p.stock_qty, 0) > 0
        AND (
          LOWER(p.name) LIKE LOWER($3)
          OR LOWER(COALESCE(p.brand, '')) LIKE LOWER($3)
          OR LOWER(COALESCE(p.category, '')) LIKE LOWER($3)
          OR LOWER(COALESCE(p.short_description, '')) LIKE LOWER($3)
        )
      ORDER BY lexical_score DESC, p.stock_qty DESC, p.id DESC
      LIMIT $4
      `,
      [variant, prefix, wildcard, limit],
    );
    for (const row of result.rows) {
      const productId = Number(row.id);
      if (!Number.isFinite(productId) || productId <= 0) continue;
      const existing = collected.get(productId);
      const lexicalScore = Number(row.lexical_score);
      if (!existing || lexicalScore > Number(existing.lexical_score || 0)) {
        collected.set(productId, {
          ...row,
          distance: null,
          lexical_score: lexicalScore,
        });
      }
    }
  }

  return Array.from(collected.values())
    .sort((a, b) => {
      const scoreDiff = Number(b.lexical_score || 0) - Number(a.lexical_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b.stock_qty || 0) - Number(a.stock_qty || 0);
    })
    .slice(0, limit);
}

async function searchBroadFallbackCandidates(query, limit) {
  const tokens = normalizeSearchText(query)
    .split(' ')
    .filter((token) => token.length >= 3)
    .slice(0, 4);

  const params = [];
  const scoreParts = [];
  const whereParts = [];

  for (const token of tokens) {
    params.push(`%${token}%`);
    const idx = params.length;
    scoreParts.push(`CASE WHEN LOWER(p.name) LIKE LOWER($${idx}) THEN 50 ELSE 0 END`);
    scoreParts.push(`CASE WHEN LOWER(COALESCE(p.category, '')) LIKE LOWER($${idx}) THEN 30 ELSE 0 END`);
    scoreParts.push(
      `CASE WHEN LOWER(COALESCE(p.short_description, '')) LIKE LOWER($${idx}) THEN 20 ELSE 0 END`,
    );
    whereParts.push(`LOWER(p.name) LIKE LOWER($${idx})`);
    whereParts.push(`LOWER(COALESCE(p.category, '')) LIKE LOWER($${idx})`);
    whereParts.push(`LOWER(COALESCE(p.short_description, '')) LIKE LOWER($${idx})`);
  }

  const hasTokenFilter = whereParts.length > 0;
  params.push(limit);
  const limitIdx = params.length;

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.short_description,
      p.description,
      p.category,
      p.brand,
      p.is_veg,
      p.price_mrp,
      p.price_sale,
      p.stock_qty,
      p.primary_image_url,
      pv.variant_label,
      pv.variant_grams,
      pv.variant_size_code,
      ${hasTokenFilter ? scoreParts.join(' + ') : '0'} AS fallback_score
    FROM products p
    LEFT JOIN LATERAL (
      SELECT
        label AS variant_label,
        grams AS variant_grams,
        size_code AS variant_size_code
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND COALESCE(pv.stock_qty, 0) > 0
      ORDER BY COALESCE(pv.grams, 0) DESC, pv.is_default DESC, pv.stock_qty DESC, pv.id ASC
      LIMIT 1
    ) pv ON TRUE
    WHERE p.is_active = TRUE
      AND COALESCE(p.stock_qty, 0) > 0
      ${hasTokenFilter ? `AND (${whereParts.join(' OR ')})` : ''}
    ORDER BY fallback_score DESC, p.stock_qty DESC, p.id DESC
    LIMIT $${limitIdx}
    `,
    params,
  );

  return result.rows.map((row) => ({
    ...row,
    distance: null,
  }));
}

function normalizeDotbotProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const product = mapProductForDotbot(raw);
  if (!Number.isFinite(Number(product.id)) || Number(product.id) <= 0) return null;
  return product;
}

function mapCandidatesToUniqueOptions(candidates, limit = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const mapped = normalizeDotbotProduct(candidate);
    if (!mapped) continue;
    const key = `${normalizeSearchText(mapped.name)}|${normalizeSearchText(mapped.size_label || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(mapped);
    if (Number.isFinite(Number(limit)) && unique.length >= Number(limit)) break;
  }
  return unique;
}

function normalizeDotbotContext(context) {
  if (!context || typeof context !== 'object') return {};
  const safe = {};

  const rawRecent = Array.isArray(context.recent_product_ids)
    ? context.recent_product_ids
    : [];
  const recentProductIds = rawRecent
    .map((value) => Number(value))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 8);
  if (recentProductIds.length > 0) {
    safe.recent_product_ids = recentProductIds;
  }

  const recentAdd = context.recent_add;
  if (recentAdd && typeof recentAdd === 'object') {
    const productId = Number(recentAdd.product_id);
    const sizeLabel = String(recentAdd.size_label || '').trim();
    if (Number.isFinite(productId) && productId > 0) {
      safe.recent_add = {
        product_id: productId,
        size_label: sizeLabel,
      };
    }
  }

  const pending = context.pending_selection;
  if (!pending || typeof pending !== 'object') return safe;

  const query = String(pending.query || '').trim();
  const quantity = clampQuantity(pending.quantity, null);
  const operation = String(pending.operation || 'add')
    .trim()
    .toLowerCase();
  const safeOperation = operation === 'remove' ? 'remove' : 'add';
  const sizeMismatch = pending.size_mismatch === true;
  const options = mapCandidatesToUniqueOptions(
    Array.isArray(pending.options) ? pending.options : [],
    getSuggestionLimit(),
  );

  if (!query || options.length === 0) return safe;
  safe.pending_selection = {
    query,
    quantity,
    options,
    operation: safeOperation,
    size_mismatch: sizeMismatch,
  };
  return safe;
}

function buildAction(product, quantity, matchedQueries = []) {
  const safeProduct = normalizeDotbotProduct(product);
  if (!safeProduct) return null;
  const quantityToAdd = clampQuantity(quantity, safeProduct.stock_qty);
  return {
    type: 'add_to_cart',
    product_id: Number(safeProduct.id),
    quantity: quantityToAdd,
    product: safeProduct,
    matched_queries: matchedQueries,
  };
}

function buildSetCartQuantityAction(product, nextQuantity, matchedQueries = []) {
  const safeProduct = normalizeDotbotProduct(product);
  if (!safeProduct) return null;
  const safeQty = Number.isFinite(Number(nextQuantity))
    ? Math.max(0, Math.round(Number(nextQuantity)))
    : 0;
  return {
    type: 'set_cart_quantity',
    product_id: Number(safeProduct.id),
    quantity: safeQty,
    product: safeProduct,
    matched_queries: matchedQueries,
  };
}

function buildCartIndex(cartItems) {
  const byId = new Map();
  for (const item of cartItems || []) {
    const productId = Number(item?.product_id);
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    byId.set(productId, {
      product_id: productId,
      quantity: Math.max(1, Math.round(quantity)),
      name: String(item?.name || '').trim(),
      size_label: String(item?.size_label || '').trim(),
    });
  }
  return byId;
}

function parseOrdinalSelection(normalizedMessage) {
  const ordinalMap = new Map([
    ['first', 1],
    ['1st', 1],
    ['second', 2],
    ['2nd', 2],
    ['third', 3],
    ['3rd', 3],
    ['fourth', 4],
    ['4th', 4],
    ['fifth', 5],
    ['5th', 5],
  ]);
  for (const [key, value] of ordinalMap.entries()) {
    if (normalizedMessage.includes(key)) return value;
  }
  return null;
}

function resolvePendingSelection(message, pendingSelection) {
  const normalized = normalizeSearchText(message);
  if (!normalized) return { status: 'unknown' };
  const isSizeMismatch = pendingSelection?.size_mismatch === true;

  if (/\b(cancel|stop|none|no|not now)\b/.test(normalized)) {
    return { status: 'cancelled' };
  }

  const options = pendingSelection.options;
  if (!Array.isArray(options) || options.length === 0) {
    return { status: 'unknown' };
  }

  if (shouldAutoPickAny(normalized)) {
    return { status: 'selected', product: pickRandomCandidate(options) || options[0] };
  }

  const directNumber = normalized.match(/\b([1-9])\b/);
  if (directNumber) {
    const index = Number(directNumber[1]) - 1;
    if (index >= 0 && index < options.length) {
      return { status: 'selected', product: options[index] };
    }
  }

  const ordinal = parseOrdinalSelection(normalized);
  if (ordinal != null) {
    const index = ordinal - 1;
    if (index >= 0 && index < options.length) {
      return { status: 'selected', product: options[index] };
    }
  }

  if (
    /\b(yes|ok|okay|confirm|go ahead)\b/.test(normalized) &&
    options.length === 1 &&
    !isSizeMismatch
  ) {
    return { status: 'selected', product: options[0] };
  }

  for (const option of options) {
    const optionName = normalizeSearchText(option.name);
    if (!optionName) continue;
    if (normalized.includes(optionName) || optionName.includes(normalized)) {
      return { status: 'selected', product: option };
    }
  }

  return { status: 'unknown' };
}

function buildSuggestionPrompt(pendingSelection) {
  const options = Array.isArray(pendingSelection?.options)
    ? pendingSelection.options
    : [];
  const operation = String(pendingSelection?.operation || 'add')
    .trim()
    .toLowerCase();
  const isRemove = operation === 'remove';
  if (options.length === 0) {
    return isRemove
      ? 'Please tell me the exact product name in your cart and I will remove it.'
      : 'Please tell me the exact product name and I will add it.';
  }

  if (options.length === 1) {
    const option = options[0];
    const price = Number(option?.price_sale);
    const safePrice = Number.isFinite(price) ? `$${price.toFixed(2)}` : '';
    const size = String(option?.size_label || '').trim();
    const detail = [size, safePrice].filter(Boolean).join(' - ');
    const extra = detail ? ` (${detail})` : '';
    if (isRemove) {
      return `I found this item in your cart: ${option.name}${extra}. Reply "yes" to remove it or "cancel".`;
    }
    return `I found this match: ${option.name}${extra}. Reply "yes" to add it or "cancel".`;
  }

  const query = String(pendingSelection?.query || 'your item').trim();
  if (isRemove) {
    const lines = options.map((option, index) => {
      const price = Number(option.price_sale);
      const safePrice = Number.isFinite(price) ? `$${price.toFixed(2)}` : '';
      const size = String(option.size_label || '').trim();
      const detail = [size, safePrice].filter(Boolean).join(' - ');
      const extra = detail ? ` - ${detail}` : '';
      return `${index + 1}. ${option.name}${extra}`;
    });
    return [
      `I found multiple matches for "${query}":`,
      '',
      lines.join('\n'),
      '',
      `Reply with a number (1-${options.length}) to remove.`,
    ].join('\n');
  }
  return (
    `I found multiple matches for "${query}". ` +
    'Use + controls below to add the item you want.'
  );
}

async function resolveAddRequestItems(detectedItems, message = '') {
  const threshold = getDistanceThreshold();
  const suggestionLimit = getSuggestionLimit();
  const actions = [];
  const unmatchedQueries = [];
  let pendingSelection = null;
  const messageAnyPreference = shouldAutoPickAny(message);

  for (const item of detectedItems) {
    if (pendingSelection) break;
    const itemAnyPreference = messageAnyPreference || shouldAutoPickAny(item.query);
    const lexicalCandidates = await searchLexicalCandidates(item.query, suggestionLimit);

    if (lexicalCandidates.length > 0) {
      if (lexicalCandidates.length === 1) {
        const action = buildAction(lexicalCandidates[0], item.quantity, [item.query]);
        if (action) actions.push(action);
        continue;
      }

      const normalizedNameQuery = normalizeQueryForNameMatch(item.query);
      const exactLexical = lexicalCandidates.find((candidate) => {
        const candidateName = normalizeProductFamilyName(candidate?.name || '');
        const candidateRaw = normalizeSearchText(candidate?.name || '');
        return (
          candidateName === normalizedNameQuery ||
          candidateRaw === normalizeSearchText(normalizedNameQuery)
        );
      });
      if (exactLexical) {
        const action = buildAction(exactLexical, item.quantity, [item.query]);
        if (action) actions.push(action);
        continue;
      }

      const dominantCoverageLexical = pickCoverageDominantCandidate(item.query, lexicalCandidates);
      if (dominantCoverageLexical) {
        const action = buildAction(
          dominantCoverageLexical,
          item.quantity,
          [item.query, 'coverage_dominant_match'],
        );
        if (action) actions.push(action);
        continue;
      }

      const confidentLexical = pickConfidentLexicalCandidate(item.query, lexicalCandidates);
      if (confidentLexical) {
        const action = buildAction(confidentLexical, item.quantity, [item.query, 'confident_match']);
        if (action) actions.push(action);
        continue;
      }

      if (canAutoPickLargestSize(lexicalCandidates)) {
        const largestLexical = pickLargestSizeCandidate(lexicalCandidates);
        const action = largestLexical
          ? buildAction(largestLexical, item.quantity, [item.query, 'largest_size'])
          : null;
        if (action) actions.push(action);
        continue;
      }

      if (itemAnyPreference) {
        const randomLexical = pickRandomCandidate(lexicalCandidates);
        const action = randomLexical
          ? buildAction(randomLexical, item.quantity, [item.query, 'any_brand'])
          : null;
        if (action) actions.push(action);
        continue;
      }

      pendingSelection = {
        operation: 'add',
        query: item.query,
        quantity: clampQuantity(item.quantity, null),
        options: mapCandidatesToUniqueOptions(lexicalCandidates, suggestionLimit),
      };
      continue;
    }

    const semanticCandidatesRaw = await searchSemanticCandidates(item.query, suggestionLimit);
    const semanticCandidates = semanticCandidatesRaw;
    if (semanticCandidates.length === 0) {
      const broadCandidates = await searchBroadFallbackCandidates(item.query, suggestionLimit);
      if (broadCandidates.length === 0) {
        unmatchedQueries.push(item.query);
        continue;
      }
      if (broadCandidates.length === 1) {
        const action = buildAction(broadCandidates[0], item.quantity, [item.query]);
        if (action) actions.push(action);
        continue;
      }
      const confidentBroad = pickConfidentLexicalCandidate(item.query, broadCandidates);
      const dominantCoverageBroad = pickCoverageDominantCandidate(item.query, broadCandidates);
      if (dominantCoverageBroad) {
        const action = buildAction(
          dominantCoverageBroad,
          item.quantity,
          [item.query, 'coverage_dominant_match'],
        );
        if (action) actions.push(action);
        continue;
      }
      if (confidentBroad) {
        const action = buildAction(
          confidentBroad,
          item.quantity,
          [item.query, 'broad_confident_match'],
        );
        if (action) actions.push(action);
        continue;
      }
      if (itemAnyPreference) {
        const randomBroad = pickRandomCandidate(broadCandidates);
        const action = randomBroad
          ? buildAction(randomBroad, item.quantity, [item.query, 'any_brand'])
          : null;
        if (action) actions.push(action);
        continue;
      }
      if (canAutoPickLargestSize(broadCandidates)) {
        const largestBroad = pickLargestSizeCandidate(broadCandidates);
        const action = largestBroad
          ? buildAction(largestBroad, item.quantity, [item.query, 'largest_size'])
          : null;
        if (action) actions.push(action);
        continue;
      }
      pendingSelection = {
        operation: 'add',
        query: item.query,
        quantity: clampQuantity(item.quantity, null),
        options: mapCandidatesToUniqueOptions(broadCandidates, suggestionLimit),
      };
      continue;
    }

    const bestSemantic = semanticCandidates[0];
    const bestDistance = Number(bestSemantic.distance);
    const strongSemanticMatch = Number.isFinite(bestDistance)
      ? bestDistance <= threshold * 0.75
      : false;

    const acceptableSemanticMatch = Number.isFinite(bestDistance)
      ? bestDistance <= threshold
      : false;

    if (semanticCandidates.length === 1 && acceptableSemanticMatch) {
      const action = buildAction(bestSemantic, item.quantity, [item.query]);
      if (action) actions.push(action);
      continue;
    }

    if (canAutoPickLargestSize(semanticCandidates)) {
      const largestSemantic = pickLargestSizeCandidate(semanticCandidates);
      const largestDistance = Number(largestSemantic?.distance);
      const acceptableLargestDistance = Number.isFinite(largestDistance)
        ? largestDistance <= threshold
        : true;
      if (largestSemantic && acceptableLargestDistance) {
        const action = buildAction(largestSemantic, item.quantity, [item.query, 'largest_size']);
        if (action) actions.push(action);
        continue;
      }
    }

    const confidentSemantic = pickConfidentLexicalCandidate(
      item.query,
      semanticCandidates,
    );
    const dominantCoverageSemantic = pickCoverageDominantCandidate(
      item.query,
      semanticCandidates,
    );
    if (dominantCoverageSemantic && acceptableSemanticMatch) {
      const action = buildAction(
        dominantCoverageSemantic,
        item.quantity,
        [item.query, 'coverage_dominant_match'],
      );
      if (action) actions.push(action);
      continue;
    }
    if (confidentSemantic && acceptableSemanticMatch) {
      const action = buildAction(
        confidentSemantic,
        item.quantity,
        [item.query, 'semantic_confident_match'],
      );
      if (action) actions.push(action);
      continue;
    }

    const nameLead = bestCandidateByNameConfidence(item.query, semanticCandidates);
    if (
      nameLead.candidate &&
      Number(nameLead.confidence) >= 0.7 &&
      acceptableSemanticMatch
    ) {
      const action = buildAction(
        nameLead.candidate,
        item.quantity,
        [item.query, 'name_confident_match'],
      );
      if (action) actions.push(action);
      continue;
    }

    if (strongSemanticMatch) {
      const action = buildAction(bestSemantic, item.quantity, [item.query]);
      if (action) actions.push(action);
      continue;
    }

    if (itemAnyPreference) {
      const semanticPool = semanticCandidates.filter((candidate) => {
        const distance = Number(candidate.distance);
        return Number.isFinite(distance) ? distance <= threshold : false;
      });
      const randomSemantic = pickRandomCandidate(
        semanticPool.length > 0 ? semanticPool : semanticCandidates,
      );
      const action = randomSemantic
        ? buildAction(randomSemantic, item.quantity, [item.query, 'any_brand'])
        : null;
      if (action) actions.push(action);
      continue;
    }

    if (!acceptableSemanticMatch) {
      pendingSelection = {
        operation: 'add',
        query: item.query,
        quantity: clampQuantity(item.quantity, null),
        options: mapCandidatesToUniqueOptions(semanticCandidates, suggestionLimit),
      };
      continue;
    }

    pendingSelection = {
      operation: 'add',
      query: item.query,
      quantity: clampQuantity(item.quantity, null),
      options: mapCandidatesToUniqueOptions(semanticCandidates, suggestionLimit),
    };
  }

  return {
    actions,
    unmatchedQueries,
    pendingSelection,
  };
}

function toCartLikeProduct(cartItem) {
  return {
    id: Number(cartItem?.product_id),
    name: String(cartItem?.name || '').trim() || `Product ${cartItem?.product_id}`,
    short_description: '',
    description: '',
    category: '',
    brand: '',
    is_veg: null,
    price_mrp: 0,
    price_sale: 0,
    stock_qty: Number(cartItem?.quantity || 0),
    primary_image_url: '',
    variant_label: String(cartItem?.size_label || '').trim(),
    variant_grams: null,
    variant_size_code: null,
  };
}

function pickRecentCartItem(context, cartIndex) {
  const recent = Array.isArray(context?.recent_product_ids)
    ? context.recent_product_ids
    : [];
  for (const candidateId of recent) {
    const item = cartIndex.get(Number(candidateId));
    if (item) return item;
  }
  return null;
}

function mergeSetQuantityActions(actions) {
  const byProduct = new Map();
  for (const action of actions) {
    if (!action) continue;
    const productId = Number(action.product_id);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    byProduct.set(productId, action);
  }
  return Array.from(byProduct.values());
}

function findBestCartMatchByText(cartIndex, query, requestedSize) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 1);
  if (queryTokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const cartItem of cartIndex.values()) {
    const cartProduct = toCartLikeProduct(cartItem);
    if (!sizeDescriptorMatches(requestedSize, getCandidateSizeDescriptor(cartProduct))) {
      continue;
    }
    const haystack = normalizeSearchText(
      `${cartItem.name || ''} ${cartItem.size_label || ''}`,
    );
    if (!haystack) continue;

    let score = 0;
    if (haystack.includes(normalizedQuery)) {
      score += 100;
    }
    for (const token of queryTokens) {
      if (haystack.includes(token)) score += 15;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cartProduct;
    }
  }
  return bestScore > 0 ? best : null;
}

async function resolveRemoveRequestItems({
  detectedItems,
  message = '',
  cartItems = [],
  context = {},
}) {
  const threshold = getDistanceThreshold();
  const suggestionLimit = getSuggestionLimit();
  const actions = [];
  const unmatchedQueries = [];
  let pendingSelection = null;
  const removeAll = shouldRemoveAll(message);
  const cartIndex = buildCartIndex(cartItems);
  const cartProductIds = new Set(cartIndex.keys());

  if (cartProductIds.size === 0) {
    return {
      actions: [],
      unmatchedQueries: detectedItems.map((item) => item.query).filter(Boolean),
      pendingSelection: null,
    };
  }

  for (const item of detectedItems) {
    if (pendingSelection) break;

    let selected = null;
    const requestedSize = getRequestedSizeDescriptor(item.query, message, detectedItems.length === 1);
    if (isPronounOnlyQuery(item.query)) {
      const recentItem = pickRecentCartItem(context, cartIndex);
      if (recentItem) {
        selected = toCartLikeProduct(recentItem);
      }
    }

    if (!selected) {
      selected = findBestCartMatchByText(cartIndex, item.query, requestedSize);
    }

    if (!selected) {
      const lexicalCandidatesRaw = await searchLexicalCandidates(item.query, suggestionLimit);
      const lexicalCandidates = filterCandidatesBySize(
        lexicalCandidatesRaw.filter((candidate) => cartProductIds.has(Number(candidate.id))),
        requestedSize,
      );

      if (lexicalCandidates.length === 1) {
        selected = lexicalCandidates[0];
      } else if (lexicalCandidates.length > 1) {
        const exactLexical = lexicalCandidates.find(
          (candidate) =>
            normalizeSearchText(candidate.name) === normalizeSearchText(item.query),
        );
        if (exactLexical) {
          selected = exactLexical;
        } else {
          const confidentLexical = pickConfidentLexicalCandidate(item.query, lexicalCandidates);
          if (confidentLexical) {
            selected = confidentLexical;
          }
        }
        if (!selected) {
          pendingSelection = {
            operation: 'remove',
            query: item.query,
            quantity: clampQuantity(item.quantity, null),
            options: mapCandidatesToUniqueOptions(lexicalCandidates, suggestionLimit),
          };
          continue;
        }
      } else {
        const semanticCandidatesRaw = await searchSemanticCandidates(item.query, suggestionLimit);
        const semanticCandidates = filterCandidatesBySize(
          semanticCandidatesRaw.filter((candidate) => cartProductIds.has(Number(candidate.id))),
          requestedSize,
        );
        if (semanticCandidates.length === 0) {
          unmatchedQueries.push(item.query);
          continue;
        }

        const best = semanticCandidates[0];
        const bestDistance = Number(best.distance);
        const acceptable = Number.isFinite(bestDistance) ? bestDistance <= threshold : true;
        if (!acceptable && semanticCandidates.length > 1) {
          pendingSelection = {
            operation: 'remove',
            query: item.query,
            quantity: clampQuantity(item.quantity, null),
            options: mapCandidatesToUniqueOptions(semanticCandidates, suggestionLimit),
          };
          continue;
        }
        selected = best;
      }
    }

    if (!selected) {
      unmatchedQueries.push(item.query);
      continue;
    }

    const productId = Number(selected.id);
    const existing = cartIndex.get(productId);
    if (!existing) {
      unmatchedQueries.push(item.query);
      continue;
    }

    const removeQty = removeAll
      ? existing.quantity
      : clampQuantity(item.quantity, existing.quantity);
    const nextQty = Math.max(0, existing.quantity - removeQty);
    const action = buildSetCartQuantityAction(selected, nextQty, [item.query]);
    if (action) {
      actions.push(action);
      if (nextQty <= 0) {
        cartIndex.delete(productId);
      } else {
        cartIndex.set(productId, {
          ...existing,
          quantity: nextQty,
        });
      }
    }
  }

  return {
    actions: mergeSetQuantityActions(actions),
    unmatchedQueries,
    pendingSelection,
  };
}

async function matchProducts(detectedItems) {
  const threshold = getDistanceThreshold();
  const matched = [];
  const unmatched = [];

  for (const item of detectedItems) {
    const semanticCandidates = await searchProductCandidates(item.query);
    let best = semanticCandidates[0] || null;
    let isSemanticMatch = false;
    if (best) {
      isSemanticMatch = Number.isFinite(best.distance)
        ? best.distance <= threshold
        : true;
    }

    if (!isSemanticMatch) {
      const lexicalCandidates = await fallbackProductCandidates(item.query);
      const lexicalBest = selectLexicalCandidate(item.query, lexicalCandidates);
      best = lexicalBest || null;
    }

    if (!best) {
      unmatched.push(item.query);
      continue;
    }

    matched.push({
      query: item.query,
      quantity: item.quantity,
      product: mapProductForDotbot(best),
      distance: best.distance,
    });
  }

  const byProductId = new Map();
  for (const item of matched) {
    const productId = Number(item.product.id);
    const maxStock = Number(item.product.stock_qty);
    const requestedQty = Number(item.quantity);
    const quantityToAdd =
      Number.isFinite(maxStock) && maxStock > 0
        ? Math.min(
            Math.max(1, Math.round(requestedQty || 1)),
            Math.max(1, Math.round(maxStock)),
          )
        : Math.max(1, Math.round(requestedQty || 1));

    if (!byProductId.has(productId)) {
      byProductId.set(productId, {
        type: 'add_to_cart',
        product_id: productId,
        quantity: quantityToAdd,
        product: item.product,
        matched_queries: [item.query],
      });
      continue;
    }

    const existing = byProductId.get(productId);
    existing.quantity =
      Number.isFinite(maxStock) && maxStock > 0
        ? Math.min(Math.round(maxStock), existing.quantity + quantityToAdd)
        : existing.quantity + quantityToAdd;
    existing.matched_queries.push(item.query);
  }

  return {
    actions: Array.from(byProductId.values()),
    unmatchedQueries: unmatched,
  };
}

function buildAddToCartReply(actions, unmatchedQueries, pendingSelection) {
  const addActions = Array.isArray(actions)
    ? actions.filter((action) => String(action?.type || '').toLowerCase() === 'add_to_cart')
    : [];
  const unmatched = Array.isArray(unmatchedQueries)
    ? unmatchedQueries
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];

  if (pendingSelection) {
    const prompt = buildSuggestionPrompt(pendingSelection);
    if (addActions.length === 0) {
      return prompt;
    }
    const added = addActions
      .slice(0, 2)
      .map((action) => `${action.quantity} x ${action.product?.name || 'item'}`)
      .join(', ');
    return `Added ${added} to your cart. ${prompt}`;
  }

  if (addActions.length === 0) {
    if (unmatched.length > 0) {
      const list = unmatched.slice(0, 2).join(', ');
      return `I couldn't confidently match ${list}. Please share a little more detail like brand or type.`;
    }
    return 'Tell me the product name and quantity, and I will add it to your cart.';
  }

  const added = addActions
    .slice(0, 3)
    .map((action) => `${action.quantity} x ${action.product?.name || 'item'}`)
    .join(', ');
  const addedSummary =
    addActions.length > 3 ? `${addActions.length} different items` : added;

  let reply = `Added ${addedSummary} to your cart.`;
  if (unmatched.length > 0) {
    reply += ` I could not find ${unmatched.slice(0, 2).join(', ')}.`;
  }
  reply += ' What else would you like?';

  return reply;
}

function buildNoopAddReply(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return '';
  }
  const first = actions[0];
  const productName = String(first?.product?.name || '').trim();
  const sizeLabel = String(first?.product?.size_label || '').trim();
  if (!productName) return '';
  if (sizeLabel) {
    return `${productName} (${sizeLabel}) is already in your cart from your last request. What else would you like?`;
  }
  return `${productName} is already in your cart from your last request. What else would you like?`;
}

function buildRemoveFromCartReply(actions, unmatchedQueries, pendingSelection) {
  const unmatched = Array.isArray(unmatchedQueries)
    ? unmatchedQueries
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];

  if (pendingSelection) {
    const prompt = buildSuggestionPrompt(pendingSelection);
    if (!Array.isArray(actions) || actions.length === 0) {
      return prompt;
    }
    const updated = actions
      .slice(0, 2)
      .map((action) => `${action.product?.name || 'item'} (${action.quantity} left)`)
      .join(', ');
    return `Updated ${updated}. ${prompt}`;
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    if (unmatched.length > 0) {
      const list = unmatched.slice(0, 2).join(', ');
      return `I couldn't find ${list} in your cart. Tell me the exact item name to remove.`;
    }
    return 'Tell me what to remove from your cart.';
  }

  const removed = actions
    .slice(0, 3)
    .map((action) => {
      const name = action.product?.name || 'item';
      if (Number(action.quantity) <= 0) {
        return name;
      }
      return `${name} (now ${action.quantity})`;
    })
    .join(', ');

  let reply = `Updated your cart: ${removed}.`;
  if (unmatched.length > 0) {
    reply += ` I could not match ${unmatched.slice(0, 2).join(', ')}.`;
  }
  reply += ' What else would you like?';
  return reply;
}

async function createAssistantReply({
  userMessage,
  intent,
  replyGoal,
  actions,
  unmatchedQueries,
  cartItems,
  conversation,
}) {
  const client = getOpenAIClient();

  const actionSummary = actions.map((action) => ({
    product_name: action.product?.name || '',
    quantity: action.quantity,
  }));

  const completion = await client.chat.completions.create({
    model: getDotBotLlmModel(),
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content:
          'You are DOTBOT, a concise grocery assistant. ' +
          'Do not list full cart contents unless user asked. ' +
          'If items were added or removed, confirm only changed items and ask what else user needs. ' +
          'Keep reply short (max 2 sentences).',
      },
      ...conversation,
      {
        role: 'user',
        content: JSON.stringify({
          user_message: userMessage,
          intent,
          reply_goal: replyGoal,
          added_actions: actionSummary,
          unmatched_queries: unmatchedQueries,
          cart_items: cartItems,
        }),
      },
    ],
  });

  return String(completion?.choices?.[0]?.message?.content || '').trim();
}

async function processDotbotMessage({
  message,
  conversation = [],
  cartItems = [],
  context = {},
}) {
  if (!isDotBotEnabled()) {
    throw new Error('DOTBOT is disabled');
  }

  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) {
    throw new Error('message is required');
  }

  const safeConversation = normalizeConversation(conversation);
  const safeCartItems = normalizeCartItems(cartItems);
  let safeContext = normalizeDotbotContext(context);

  if (safeContext.pending_selection) {
    const pendingOperation =
      String(safeContext.pending_selection.operation || 'add').toLowerCase() === 'remove'
        ? 'remove'
        : 'add';
    const selection = resolvePendingSelection(normalizedMessage, safeContext.pending_selection);
    if (selection.status === 'selected' && selection.product) {
      let action = null;
      if (pendingOperation === 'remove') {
        const cartIndex = buildCartIndex(safeCartItems);
        const selectedProductId = Number(selection.product.id);
        const existing = cartIndex.get(selectedProductId);
        if (existing) {
          const removeQty = clampQuantity(
            safeContext.pending_selection.quantity,
            existing.quantity,
          );
          const nextQty = Math.max(0, existing.quantity - removeQty);
          action = buildSetCartQuantityAction(
            selection.product,
            nextQty,
            [safeContext.pending_selection.query],
          );
        }
      } else {
        action = buildAction(
          selection.product,
          safeContext.pending_selection.quantity,
          [safeContext.pending_selection.query],
        );
      }
      const actions = action ? [action] : [];
      const reply = pendingOperation === 'remove'
        ? buildRemoveFromCartReply(actions, [], null)
        : actions.length > 0
            ? `Added ${actions[0].quantity} x ${actions[0].product.name} to your cart. What else would you like?`
            : 'I could not add that item. Please try again.';
      return {
        intent: pendingOperation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
        endConversation: false,
        reply,
        actions,
        unmatchedQueries: [],
        context: {
          recent_product_ids:
            actions.length > 0
              ? actions
                  .map((actionItem) => Number(actionItem.product_id))
                  .filter((id) => Number.isFinite(id) && id > 0)
                  .slice(0, 8)
              : Array.isArray(safeContext.recent_product_ids)
                  ? safeContext.recent_product_ids
                  : [],
        },
      };
    }
    if (selection.status === 'cancelled') {
      return {
        intent: pendingOperation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
        endConversation: false,
        reply:
          pendingOperation === 'remove'
            ? 'Okay, I cancelled that removal. Tell me what to remove from your cart.'
            : 'Okay, I cancelled that selection. Tell me what you want to add.',
        actions: [],
        unmatchedQueries: [],
        context: {
          recent_product_ids: Array.isArray(safeContext.recent_product_ids)
            ? safeContext.recent_product_ids
            : [],
        },
      };
    }
    if (looksLikeSelectionFollowup(normalizedMessage)) {
      return {
        intent: pendingOperation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
        endConversation: false,
        reply: buildSuggestionPrompt(safeContext.pending_selection),
        actions: [],
        unmatchedQueries: [],
        context: safeContext,
      };
    }
    safeContext = {
      recent_product_ids: Array.isArray(safeContext.recent_product_ids)
        ? safeContext.recent_product_ids
        : [],
    };
  }

  const directCommand = extractDirectCommand(normalizedMessage);
  let detected = null;
  if (directCommand) {
    detected = {
      intent: directCommand.intent,
      conversationEnd: false,
      items: normalizeDetectedItems(directCommand.items),
      replyGoal: '',
    };
  }
  if (!detected) {
    detected = await detectIntent({
      message: normalizedMessage,
      conversation: safeConversation,
      cartItems: safeCartItems,
    });
  }

  let actions = [];
  let unmatchedQueries = [];
  let pendingSelection = null;

  if (detected.intent === 'add_to_cart' && detected.items.length > 0) {
    const resolved = await resolveAddRequestItems(detected.items, normalizedMessage);
    actions = resolved.actions;
    unmatchedQueries = resolved.unmatchedQueries;
    pendingSelection = resolved.pendingSelection;
    if (
      pendingSelection &&
      pendingSelection.size_mismatch !== true &&
      Array.isArray(pendingSelection.options) &&
      pendingSelection.options.length === 1
    ) {
      const autoAction = buildAction(
        pendingSelection.options[0],
        pendingSelection.quantity,
        [pendingSelection.query, 'single_option_auto_add'],
      );
      if (autoAction) {
        actions.push(autoAction);
        pendingSelection = null;
      }
    }

    const recentAdd = safeContext.recent_add;
    if (
      recentAdd &&
      typeof recentAdd === 'object' &&
      actions.length === 1 &&
      shouldTreatAsRepeatClarification(normalizedMessage)
    ) {
      const action = actions[0];
      const recentProductId = Number(recentAdd.product_id);
      const currentProductId = Number(action?.product_id);
      const recentSizeLabel = String(recentAdd.size_label || '').trim().toLowerCase();
      const currentSizeLabel = String(action?.product?.size_label || '').trim().toLowerCase();
      if (
        Number.isFinite(recentProductId) &&
        recentProductId > 0 &&
        recentProductId === currentProductId &&
        recentSizeLabel &&
        currentSizeLabel &&
        recentSizeLabel === currentSizeLabel
      ) {
        const noopReply = buildNoopAddReply(actions);
        if (noopReply) {
          return {
            intent: detected.intent,
            endConversation: false,
            reply: noopReply,
            actions: [],
            unmatchedQueries,
            context: {
              ...safeContext,
              recent_add: {
                product_id: recentProductId,
                size_label: recentSizeLabel,
              },
            },
          };
        }
      }
    }
  } else if (detected.intent === 'remove_from_cart' && detected.items.length > 0) {
    const resolved = await resolveRemoveRequestItems({
      detectedItems: detected.items,
      message: normalizedMessage,
      cartItems: safeCartItems,
      context: safeContext,
    });
    actions = resolved.actions;
    unmatchedQueries = resolved.unmatchedQueries;
    pendingSelection = resolved.pendingSelection;
  }

  if (actions.length > 0) {
    actions = await enrichActionsWithVariants(actions);
  }

  let reply = '';
  if (detected.intent === 'add_to_cart') {
    reply = buildAddToCartReply(actions, unmatchedQueries, pendingSelection);
  } else if (detected.intent === 'remove_from_cart') {
    reply = buildRemoveFromCartReply(actions, unmatchedQueries, pendingSelection);
  } else {
    reply = await createAssistantReply({
      userMessage: normalizedMessage,
      intent: detected.intent,
      replyGoal: detected.replyGoal,
      actions,
      unmatchedQueries,
      cartItems: safeCartItems,
      conversation: safeConversation,
    });
  }

  if (!reply) {
    reply =
      actions.length > 0
        ? detected.intent === 'remove_from_cart'
          ? 'Updated your cart. What else would you like?'
          : 'Added those items. What else would you like?'
        : detected.intent === 'remove_from_cart'
          ? 'Tell me what item to remove from your cart.'
          : 'Tell me what products you want, and I will add them to your cart.';
  }

  const endConversation =
    detected.conversationEnd === true || detected.intent === 'checkout';

  const nextRecentProductIds =
    actions.length > 0
      ? actions
          .map((action) => Number(action.product_id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .slice(0, 8)
      : Array.isArray(safeContext.recent_product_ids)
          ? safeContext.recent_product_ids
          : [];

  const nextContext = {};
  if (nextRecentProductIds.length > 0) {
    nextContext.recent_product_ids = nextRecentProductIds;
  }
  const firstAddAction = actions.find(
    (action) => String(action?.type || '').toLowerCase() === 'add_to_cart',
  );
  if (firstAddAction && Number(firstAddAction.product_id) > 0) {
    nextContext.recent_add = {
      product_id: Number(firstAddAction.product_id),
      size_label: String(firstAddAction?.product?.size_label || '').trim(),
    };
  } else if (safeContext.recent_add) {
    nextContext.recent_add = safeContext.recent_add;
  }
  if (pendingSelection) {
    nextContext.pending_selection = pendingSelection;
  }

  return {
    intent: detected.intent,
    endConversation,
    reply,
    actions,
    unmatchedQueries,
    context: nextContext,
  };
}

async function transcribeAudioBase64({
  audioBase64,
  mimeType = 'audio/m4a',
}) {
  if (!isDotBotEnabled()) {
    throw new Error('DOTBOT is disabled');
  }

  const encoded = normalizeAudioBase64Input(audioBase64);
  if (!encoded) {
    throw new Error('audio_base64 is required');
  }

  const client = getOpenAIClient();
  const audioBuffer = Buffer.from(encoded, 'base64');
  if (!audioBuffer.length) {
    throw new Error('audio_base64 could not be decoded');
  }

  const mimeMeta = resolveAudioMimeMeta(mimeType);
  const extension = mimeMeta.extension;
  const file = await toFile(audioBuffer, `dotbot-input.${extension}`, {
    type: mimeMeta.mimeType,
  });

  const modelsToTry = [
    getDotBotSttModel(),
    ...getDotBotSttFallbackModels(),
  ].filter(Boolean);
  const uniqueModels = Array.from(new Set(modelsToTry));

  let lastError = null;
  for (const model of uniqueModels) {
    try {
      const transcription = await client.audio.transcriptions.create({
        model,
        file,
        language: getDotBotSttLanguage(),
        prompt:
          'Transcribe in English using Latin script. Keep grocery and brand names in English if possible.',
      });
      const text = String(transcription?.text || '').trim();
      if (text) return text;
    } catch (error) {
      lastError = error;
      if (!shouldRetryWithFallbackModel(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return '';
}

async function synthesizeSpeechBase64({ text }) {
  if (!isDotBotEnabled()) {
    throw new Error('DOTBOT is disabled');
  }
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw new Error('text is required');
  }

  const client = getOpenAIClient();
  const modelsToTry = [
    getDotBotTtsModel(),
    ...getDotBotTtsFallbackModels(),
  ].filter(Boolean);
  const uniqueModels = Array.from(new Set(modelsToTry));

  let lastError = null;
  for (const model of uniqueModels) {
    try {
      const audio = await client.audio.speech.create({
        model,
        voice: getDotBotTtsVoice(),
        input: normalized,
        format: 'mp3',
      });
      const buffer = Buffer.from(await audio.arrayBuffer());
      if (!buffer.length) continue;
      return {
        audioBase64: buffer.toString('base64'),
        mimeType: 'audio/mpeg',
      };
    } catch (error) {
      lastError = error;
      if (!shouldRetryWithFallbackModel(error)) {
        throw error;
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error('TTS returned empty audio');
}

module.exports = {
  processDotbotMessage,
  transcribeAudioBase64,
  synthesizeSpeechBase64,
};
