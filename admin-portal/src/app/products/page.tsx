'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  Eye,
  Package,
  Loader2,
} from 'lucide-react';
import { Product } from '@/types';
import { formatCurrency, cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const PAGE_SIZE = 30;

interface ProductsApiResponse {
  products?: Product[];
  page_info?: {
    has_more?: boolean;
    next_cursor?: string | null;
  };
}

function getDisplayPrices(product: Product) {
  const mrp = Number(product.price_mrp) || 0;
  const sale = Number(product.price_sale) || 0;
  const hasDiscount = mrp > 0 && sale > 0 && sale < mrp;

  return {
    primaryPrice: hasDiscount ? sale : mrp,
    mrp,
    hasDiscount,
  };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchProducts = useCallback(async ({
    reset,
    cursor,
  }: {
    reset: boolean;
    cursor?: string | null;
  }) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      setError(null);
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (appliedSearch) {
        params.set('search', appliedSearch);
      }
      if (!reset && cursor) {
        params.set('cursor', cursor);
      }

      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch products (${res.status})`);
      }

      const data = (await res.json()) as ProductsApiResponse;
      const incoming = Array.isArray(data.products) ? data.products : [];

      if (reset) {
        setProducts(incoming);
      } else {
        setProducts((prev) => {
          const seen = new Set(prev.map((item) => String(item.id)));
          const merged = [...prev];
          for (const row of incoming) {
            if (!seen.has(String(row.id))) {
              merged.push(row);
              seen.add(String(row.id));
            }
          }
          return merged;
        });
      }

      setHasMore(Boolean(data.page_info?.has_more));
      setNextCursor(data.page_info?.next_cursor || null);
    } catch (fetchError) {
      console.error('Failed to fetch products:', fetchError);
      if (reset) {
        setProducts([]);
      }
      setHasMore(false);
      setNextCursor(null);
      setError('Could not load products. Please try again.');
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [appliedSearch]);

  useEffect(() => {
    void fetchProducts({ reset: true });
  }, [fetchProducts]);

  const deleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => String(p.id) !== String(id)));
      }
    } catch (deleteError) {
      console.error('Failed to delete product:', deleteError);
    }
  };

  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setAppliedSearch(searchQuery.trim());
  };

  const clearSearch = () => {
    setSearchQuery('');
    setAppliedSearch('');
  };

  return (
    <div className="space-y-8 [--radius-sm:0.25rem] [--radius-md:0.5rem] [--radius-lg:0.75rem] [--radius-xl:0.75rem] [--radius-2xl:1rem] [--radius-3xl:1.5rem]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Products</h1>
          <p className="text-foreground/50 mt-1">Manage your inventory and product listings.</p>
        </div>
        <Link
          href="/products/new"
          className="inline-flex items-center justify-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          <Plus className="w-5 h-5" />
          Add New Product
        </Link>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-border flex flex-col md:flex-row gap-4 justify-between bg-surface/30">
          <form className="relative flex-1 max-w-md" onSubmit={onSearchSubmit}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/30" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-24 py-2.5 bg-white border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
            >
              Search
            </button>
          </form>
          <div className="flex items-center gap-3">
            <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-border rounded-xl text-sm font-medium text-foreground/60 hover:text-primary hover:border-primary/20 transition-all">
              <Filter className="w-4 h-4" />
              Filter
            </button>
            <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-border rounded-xl text-sm font-medium text-foreground/60 hover:text-primary hover:border-primary/20 transition-all">
              Export
            </button>
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface/50">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">Product</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">Category</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">Price</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">Stock</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">Status</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <AnimatePresence mode="popLayout">
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-6 py-4">
                        <div className="h-12 rounded-lg w-full shimmer"></div>
                      </td>
                    </tr>
                  ))
                ) : products.length > 0 ? (
                  products.map((product) => {
                    const { primaryPrice, mrp, hasDiscount } = getDisplayPrices(product);

                    return (
                    <motion.tr
                      key={product.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="group hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-surface border border-border flex-shrink-0 relative">
                            {product.primary_image_url ? (
                              <img
                                src={product.primary_image_url}
                                alt={product.name}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="w-6 h-6 text-foreground/20" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{product.name}</p>
                            <p className="text-xs text-foreground/40 mt-0.5">{product.brand}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {product.category}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-foreground">{formatCurrency(primaryPrice)}</p>
                        {hasDiscount ? (
                          <p className="text-xs text-foreground/40 line-through">{formatCurrency(mrp)}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full',
                              product.stock_qty > 10 ? 'bg-green-500' : product.stock_qty > 0 ? 'bg-amber-500' : 'bg-red-500',
                            )}
                          ></div>
                          <span className="text-sm font-medium text-foreground">{product.stock_qty} in stock</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold',
                            product.is_active
                              ? 'bg-green-50/50 text-green-600 border border-green-100'
                              : 'bg-red-50/50 text-red-600 border border-red-100',
                          )}
                        >
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button className="p-2 hover:bg-white hover:shadow-md rounded-lg text-foreground/40 hover:text-primary transition-all">
                            <Eye className="w-4 h-4" />
                          </button>
                          <Link href={`/products/edit/${product.id}`} className="p-2 hover:bg-white hover:shadow-md rounded-lg text-foreground/40 hover:text-primary transition-all">
                            <Edit className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => deleteProduct(String(product.id))}
                            className="p-2 hover:bg-white hover:shadow-md rounded-lg text-foreground/40 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center">
                          <Package className="w-8 h-8 text-foreground/20" />
                        </div>
                        <p className="text-foreground/50 font-medium">No products found.</p>
                        {(appliedSearch || searchQuery) && (
                          <button onClick={clearSearch} className="text-primary text-sm font-bold hover:underline">
                            Clear search
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border">
          <AnimatePresence mode="popLayout">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="p-4 space-y-3">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 rounded-xl shimmer"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 rounded w-3/4 shimmer"></div>
                      <div className="h-3 rounded w-1/2 shimmer"></div>
                    </div>
                  </div>
                </div>
              ))
            ) : products.length > 0 ? (
              products.map((product) => {
                const { primaryPrice, mrp, hasDiscount } = getDisplayPrices(product);

                return (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-4 space-y-4"
                >
                  <div className="flex gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface border border-border flex-shrink-0 relative">
                      {product.primary_image_url ? (
                        <img src={product.primary_image_url} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-6 h-6 text-foreground/20" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground truncate">{product.name}</p>
                          <p className="text-xs text-foreground/40">{product.brand}</p>
                        </div>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                            product.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                          )}
                        >
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 bg-primary/10 text-primary rounded-full">{product.category}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="space-y-1">
                      <p className="text-xs text-foreground/40 font-medium uppercase tracking-wider">Price & Stock</p>
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-bold text-foreground">{formatCurrency(primaryPrice)}</p>
                          {hasDiscount ? (
                            <p className="text-xs text-foreground/40 line-through">{formatCurrency(mrp)}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div
                            className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              product.stock_qty > 10 ? 'bg-green-500' : product.stock_qty > 0 ? 'bg-amber-500' : 'bg-red-500',
                            )}
                          ></div>
                          <span className="text-xs font-medium text-foreground/60">{product.stock_qty} units</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/products/edit/${product.id}`}
                        className="p-2.5 bg-surface hover:bg-primary/10 rounded-xl text-foreground/60 hover:text-primary transition-all border border-border"
                      >
                        <Edit className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => deleteProduct(String(product.id))}
                        className="p-2.5 bg-surface hover:bg-red-50 rounded-xl text-foreground/60 hover:text-red-500 transition-all border border-border"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
                );
              })
            ) : (
              <div className="p-8 text-center">
                <p className="text-foreground/50">No products found.</p>
              </div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-6 border-t border-border bg-surface/30 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-foreground/50">
            Showing <span className="font-semibold text-foreground">{products.length}</span> loaded products
            {appliedSearch ? (
              <span>
                {' '}
                for <span className="font-semibold text-foreground">&quot;{appliedSearch}&quot;</span>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
            {hasMore ? (
              <button
                onClick={() => void fetchProducts({ reset: false, cursor: nextCursor })}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
