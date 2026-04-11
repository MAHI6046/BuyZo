'use client';

import React, { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Tags,
  CheckCircle2,
  XCircle,
  Upload,
} from 'lucide-react';
import { Category } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

type EditableCategory = {
  id: string;
  name: string;
  image_url: string;
  is_active: boolean;
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditableCategory | null>(null);

  useEffect(() => {
    void fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  const uploadCategoryImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'categories');

    const uploadRes = await fetch('/api/upload-image', {
      method: 'POST',
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson?.publicUrl) {
      throw new Error(
        String(uploadJson?.error || uploadJson?.details || 'Failed to upload category image'),
      );
    }
    return String(uploadJson.publicUrl);
  };

  const addCategory = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image_url: newImageUrl.trim() || null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Failed to add category'));
      }
      setNewName('');
      setNewImageUrl('');
      setIsAdding(false);
      await fetchCategories();
    } catch (error) {
      console.error('Failed to add category:', error);
      alert(error instanceof Error ? error.message : 'Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  const saveCategoryEdit = async () => {
    if (!editing || saving) return;
    const name = editing.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/categories/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          image_url: editing.image_url.trim() || null,
          is_active: editing.is_active,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Failed to update category'));
      }
      setEditing(null);
      await fetchCategories();
    } catch (error) {
      console.error('Failed to update category:', error);
      alert(error instanceof Error ? error.message : 'Failed to update category');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: Category) => {
    if (saving) return;
    const ok = confirm(
      `Delete "${category.name}"?\n\nProducts in this category will lose their category link.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Failed to delete category'));
      }
      await fetchCategories();
    } catch (error) {
      console.error('Failed to delete category:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setSaving(false);
    }
  };

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Categories</h1>
          <p className="text-foreground/50 mt-1">
            Manage product categories, visibility, and category images.
          </p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="inline-flex items-center justify-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          <Plus className="w-5 h-5" />
          Add Category
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white border border-border rounded-2xl p-6 shadow-sm overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground/70">Category Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Fruits & Vegetables"
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground/70">Image URL</label>
                <input
                  type="url"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface cursor-pointer hover:bg-surface/80 transition-all">
                <Upload className="w-4 h-4" />
                <span className="text-sm font-semibold">Upload Image</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setSaving(true);
                      const url = await uploadCategoryImage(file);
                      setNewImageUrl(url);
                    } catch (error) {
                      alert(
                        error instanceof Error
                          ? error.message
                          : 'Failed to upload category image',
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
              </label>
              <div className="flex gap-2 md:ml-auto">
                <button
                  onClick={() => {
                    if (saving) return;
                    setIsAdding(false);
                    setNewName('');
                    setNewImageUrl('');
                  }}
                  className="px-6 py-2.5 bg-surface text-foreground/60 rounded-xl font-bold hover:bg-surface/80 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={addCategory}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Category'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-border flex flex-col md:flex-row gap-4 justify-between bg-surface/30">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/30" />
            <input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-white border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface/50">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">
                  Category
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">
                  Slug
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">
                  Image
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border">
                  Status
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-foreground/40 border-b border-border text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-6 py-4">
                      <div className="h-10 rounded-lg w-full shimmer"></div>
                    </td>
                  </tr>
                ))
              ) : filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-foreground/50">
                    No categories found.
                  </td>
                </tr>
              ) : (
                filteredCategories.map((category) => (
                  <motion.tr
                    key={category.id}
                    layout
                    className="group hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary overflow-hidden">
                          {category.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={category.image_url}
                              alt={category.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Tags className="w-5 h-5" />
                          )}
                        </div>
                        <span className="font-semibold text-foreground">{category.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-foreground/40">
                      {category.slug}
                    </td>
                    <td className="px-6 py-4 text-xs text-foreground/50">
                      {category.image_url ? 'Yes' : 'No'}
                    </td>
                    <td className="px-6 py-4">
                      {category.is_active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-50 text-green-600 border border-green-100">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-100">
                          <XCircle className="w-3.5 h-3.5" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() =>
                            setEditing({
                              id: String(category.id),
                              name: category.name,
                              image_url: String(category.image_url || ''),
                              is_active: category.is_active === true,
                            })
                          }
                          className="p-2 hover:bg-white hover:shadow-md rounded-lg text-foreground/40 hover:text-primary transition-all"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void deleteCategory(category)}
                          className="p-2 hover:bg-white hover:shadow-md rounded-lg text-foreground/40 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-xl"
            >
              <h2 className="text-xl font-bold text-foreground">Edit Category</h2>
              <div className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-foreground/70">Name</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, name: e.target.value } : prev,
                      )
                    }
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-foreground/70">Image URL</label>
                  <input
                    type="url"
                    value={editing.image_url}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, image_url: e.target.value } : prev,
                      )
                    }
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, is_active: e.target.checked } : prev,
                      )
                    }
                  />
                  <span className="font-medium text-foreground/70">Active</span>
                </label>
                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface cursor-pointer hover:bg-surface/80 transition-all">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm font-semibold">Upload Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        setSaving(true);
                        const url = await uploadCategoryImage(file);
                        setEditing((prev) =>
                          prev ? { ...prev, image_url: url } : prev,
                        );
                      } catch (error) {
                        alert(
                          error instanceof Error
                            ? error.message
                            : 'Failed to upload category image',
                        );
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="px-6 py-2.5 bg-surface text-foreground/60 rounded-xl font-bold hover:bg-surface/80 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveCategoryEdit()}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
