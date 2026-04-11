import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

function normalizeImageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (entry && typeof entry === 'object' && 'image_url' in entry) {
        return String((entry as { image_url?: unknown }).image_url || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeHighlights(highlights: unknown): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (entry && typeof entry === 'object' && 'highlight' in entry) {
        return String((entry as { highlight?: unknown }).highlight || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeNutrition(nutrition: unknown) {
  if (!Array.isArray(nutrition)) return [];

  return nutrition
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const nutrient = String((row as { nutrient?: unknown }).nutrient || '').trim();
      const value = String((row as { value?: unknown }).value || '').trim();
      if (!nutrient || !value) return null;
      return { nutrient, value };
    })
    .filter(Boolean);
}

function normalizeVariants(variants: unknown) {
  if (!Array.isArray(variants)) return [];

  return variants
    .map((variant) => {
      if (!variant || typeof variant !== 'object') return null;
      const label = String((variant as { label?: unknown }).label || '').trim();
      if (!label) return null;

      return {
        label,
        grams: (variant as { grams?: unknown }).grams,
        size_code: (variant as { size_code?: unknown }).size_code,
        mrp: (variant as { mrp?: unknown }).mrp,
        sale_price: (variant as { sale_price?: unknown }).sale_price,
        stock_qty: (variant as { stock_qty?: unknown }).stock_qty,
        is_default: Boolean((variant as { is_default?: unknown }).is_default),
      };
    })
    .filter(Boolean);
}

function normalizeCategoryId(categoryId: unknown): number | undefined {
  const parsed = Number(categoryId);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBackendProductPayload(rawBody: unknown) {
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};

  return {
    name: (body as { name?: unknown }).name,
    slug: (body as { slug?: unknown }).slug,
    short_description: (body as { short_description?: unknown }).short_description,
    description: (body as { description?: unknown }).description,
    category: (body as { category?: unknown }).category,
    category_id: normalizeCategoryId((body as { category_id?: unknown }).category_id),
    brand: (body as { brand?: unknown }).brand,
    is_veg: (body as { is_veg?: unknown }).is_veg,
    is_active: (body as { is_active?: unknown }).is_active,
    price_mrp: (body as { price_mrp?: unknown }).price_mrp,
    price_sale: (body as { price_sale?: unknown }).price_sale,
    stock_qty: (body as { stock_qty?: unknown }).stock_qty,
    primary_image_url: (body as { primary_image_url?: unknown }).primary_image_url,
    images: normalizeImageUrls((body as { images?: unknown }).images),
    variants: normalizeVariants((body as { variants?: unknown }).variants),
    highlights: normalizeHighlights((body as { highlights?: unknown }).highlights),
    nutrition: normalizeNutrition((body as { nutrition?: unknown }).nutrition),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    const payload = await backendAdminFetchJson<{ product?: unknown }>(
      `/api/admin/products/${id}`,
    );

    if (!payload.product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(payload.product);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    const body = await request.json();

    await backendAdminFetchJson(`/api/admin/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(toBackendProductPayload(body)),
    });

    return NextResponse.json({ message: 'Product updated successfully' });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    await backendAdminFetchJson(`/api/admin/products/${id}`, {
      method: 'DELETE',
    });
    return NextResponse.json({ message: 'Product deleted successfully' });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
