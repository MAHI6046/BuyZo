'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Save, 
  Image as ImageIcon, 
  Upload,
  Plus, 
  Trash2, 
  ChevronRight,
  Info,
  DollarSign,
  Package,
  Layers,
  Star,
  Activity
} from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn, slugify } from '@/lib/utils';
import { Category } from '@/types';
import { motion } from 'framer-motion';

const productSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  slug: z.string().min(3, 'Slug must be at least 3 characters'),
  short_description: z.string().optional(),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  category_id: z.string().optional(),
  brand: z.string().optional(),
  is_veg: z.boolean().default(true),
  is_active: z.boolean().default(true),
  price_mrp: z.coerce.number().min(0),
  price_sale: z.coerce.number().min(0),
  stock_qty: z.coerce.number().min(0),
  primary_image_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  images: z.array(z.object({
    image_url: z.string().url('Must be a valid URL'),
    sort_order: z.number()
  })).default([]),
  variants: z.array(z.object({
    label: z.string().min(1, 'Label is required'),
    grams: z.coerce.number().optional(),
    size_code: z.string().optional(),
    mrp: z.coerce.number().min(0),
    sale_price: z.coerce.number().min(0),
    stock_qty: z.coerce.number().min(0),
    is_default: z.boolean().default(false)
  })).default([]),
  highlights: z.array(z.object({
    highlight: z.string().min(1, 'Highlight is required'),
    sort_order: z.number()
  })).default([]),
  nutrition: z.array(z.object({
    nutrient: z.string().min(1, 'Nutrient is required'),
    value: z.string().min(1, 'Value is required'),
    sort_order: z.number()
  })).default([])
});

type ProductFormInput = z.input<typeof productSchema>;
type ProductFormValues = z.output<typeof productSchema>;

const tabs = [
  { id: 'general', name: 'General', icon: Info },
  { id: 'pricing', name: 'Pricing', icon: DollarSign },
  { id: 'media', name: 'Media', icon: ImageIcon },
  { id: 'variants', name: 'Variants', icon: Layers },
  { id: 'details', name: 'Highlights & Nutrition', icon: Star },
];

export default function NewProductPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('general');
  const [categories, setCategories] = useState<Category[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPrimary, setIsUploadingPrimary] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      is_veg: true,
      is_active: true,
      price_mrp: 0,
      price_sale: 0,
      stock_qty: 0,
      images: [],
      variants: [],
      highlights: [],
      nutrition: []
    }
  });

  const { fields: imageFields, append: appendImage, remove: removeImage } = useFieldArray({ control, name: "images" });
  const { fields: variantFields, append: appendVariant, remove: removeVariant } = useFieldArray({ control, name: "variants" });
  const { fields: highlightFields, append: appendHighlight, remove: removeHighlight } = useFieldArray({ control, name: "highlights" });
  const { fields: nutritionFields, append: appendNutrition, remove: removeNutrition } = useFieldArray({ control, name: "nutrition" });

  const productName = watch('name');
  
  useEffect(() => {
    if (productName) {
      setValue('slug', slugify(productName));
    }
  }, [productName, setValue]);

  useEffect(() => {
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, []);

  const uploadProductImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'products');

    const uploadRes = await fetch('/api/upload-image', {
      method: 'POST',
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson?.publicUrl) {
      throw new Error(
        String(uploadJson?.error || uploadJson?.details || 'Failed to upload product image'),
      );
    }
    return String(uploadJson.publicUrl);
  };

  const onSubmit = async (data: ProductFormValues) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        router.push('/products');
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to create product:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="p-2.5 hover:bg-surface rounded-xl border border-border transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Add New Product</h1>
            <p className="text-sm md:text-base text-foreground/50 mt-1">Fill in the details to create a new product listing.</p>
          </div>
        </div>
        <button 
          onClick={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          className="w-full md:w-auto inline-flex items-center justify-center gap-2 bg-primary text-white px-8 py-3.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : (
            <>
              <Save className="w-5 h-5" />
              Save Product
            </>
          )}
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Sidebar Tabs */}
        <div className="w-full md:w-64 flex-shrink-0">
          <div className="bg-white border border-border rounded-2xl p-2 sticky top-24 md:top-28 shadow-sm flex md:flex-col overflow-x-auto no-scrollbar md:overflow-visible gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold whitespace-nowrap",
                  activeTab === tab.id 
                    ? "bg-primary text-white shadow-md shadow-primary/10" 
                    : "text-foreground/50 hover:bg-primary/5 hover:text-primary"
                )}
              >
                <tab.icon className="w-5 h-5" />
                <span className="hidden md:inline">{tab.name}</span>
                <span className="md:hidden">{tab.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 min-w-0">
          <form className="space-y-6">
            {activeTab === 'general' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white border border-border rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-sm space-y-6 md:space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Product Name</label>
                    <input 
                      {...register('name')}
                      placeholder="e.g. Fresh Organic Tomatoes"
                      className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                    {errors.name && <p className="text-xs text-red-500 ml-1 font-medium">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Slug</label>
                    <input 
                      {...register('slug')}
                      placeholder="fresh-organic-tomatoes"
                      className="w-full px-5 py-3.5 bg-surface/50 border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Category</label>
                    <select 
                      {...register('category')}
                      className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all appearance-none"
                    >
                      <option value="">Select a category</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    {errors.category && <p className="text-xs text-red-500 ml-1 font-medium">{errors.category.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Brand</label>
                    <input 
                      {...register('brand')}
                      placeholder="e.g. Nature's Best"
                      className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground/70 ml-1">Short Description</label>
                  <input 
                    {...register('short_description')}
                    placeholder="Brief overview of the product..."
                    className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground/70 ml-1">Full Description</label>
                  <textarea 
                    {...register('description')}
                    rows={5}
                    placeholder="Detailed description, benefits, etc."
                    className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'pricing' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white border border-border rounded-3xl p-8 shadow-sm space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">MRP (Maximum Retail Price)</label>
                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-foreground/30 font-bold">₹</span>
                      <input 
                        type="number"
                        {...register('price_mrp')}
                        className="w-full pl-10 pr-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Sale Price</label>
                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-foreground/30 font-bold">₹</span>
                      <input 
                        type="number"
                        {...register('price_sale')}
                        className="w-full pl-10 pr-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-primary"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Stock Quantity</label>
                    <div className="relative">
                      <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-foreground/30 w-5 h-5" />
                      <input 
                        type="number"
                        {...register('stock_qty')}
                        className="w-full pl-12 pr-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-8 h-full pt-6">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input 
                        type="checkbox"
                        {...register('is_veg')}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <span className="text-sm font-bold text-foreground/70 group-hover:text-primary transition-colors">Vegetarian Product</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input 
                        type="checkbox"
                        {...register('is_active')}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <span className="text-sm font-bold text-foreground/70 group-hover:text-primary transition-colors">Active Listing</span>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'media' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white border border-border rounded-3xl p-8 shadow-sm space-y-8"
              >
                <div className="space-y-4">
                  <label className="text-sm font-bold text-foreground/70 ml-1">Primary Image URL</label>
                  <div className="flex gap-6">
                    <div className="w-32 h-32 bg-surface border-2 border-dashed border-border rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
                      {watch('primary_image_url') ? (
                        <img src={watch('primary_image_url')} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-foreground/20" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <input 
                        {...register('primary_image_url')}
                        placeholder="https://example.com/image.jpg"
                        className="w-full px-5 py-3.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                      />
                      <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface cursor-pointer hover:bg-surface/80 transition-all w-fit">
                        <Upload className="w-4 h-4" />
                        <span className="text-sm font-semibold">
                          {isUploadingPrimary ? 'Uploading...' : 'Upload Primary Image'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={isUploadingPrimary}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              setIsUploadingPrimary(true);
                              const url = await uploadProductImage(file);
                              setValue('primary_image_url', url, { shouldValidate: true });
                            } catch (error) {
                              alert(
                                error instanceof Error
                                  ? error.message
                                  : 'Failed to upload primary image',
                              );
                            } finally {
                              setIsUploadingPrimary(false);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      <p className="text-xs text-foreground/40 italic">This image will be used as the main thumbnail.</p>
                    </div>
                  </div>
                </div>

                <div className="h-[1px] bg-border"></div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-foreground/70 ml-1">Additional Gallery Images</label>
                    <button 
                      type="button"
                      onClick={() => appendImage({ image_url: '', sort_order: imageFields.length })}
                      className="text-primary text-sm font-bold flex items-center gap-1.5 hover:underline"
                    >
                      <Plus className="w-4 h-4" /> Add Image
                    </button>
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-surface cursor-pointer hover:bg-surface/80 transition-all">
                      <Upload className="w-4 h-4" />
                      <span className="text-sm font-semibold">
                        {isUploadingGallery ? 'Uploading...' : 'Upload Image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploadingGallery}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            setIsUploadingGallery(true);
                            const url = await uploadProductImage(file);
                            appendImage({ image_url: url, sort_order: imageFields.length });
                          } catch (error) {
                            alert(
                              error instanceof Error
                                ? error.message
                                : 'Failed to upload gallery image',
                            );
                          } finally {
                            setIsUploadingGallery(false);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {imageFields.map((field, index) => (
                      <div key={field.id} className="flex gap-4 items-center">
                        <div className="w-12 h-12 bg-surface rounded-lg flex items-center justify-center overflow-hidden border border-border">
                          {watch(`images.${index}.image_url`) ? (
                            <img src={watch(`images.${index}.image_url`)} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-foreground/20" />
                          )}
                        </div>
                        <input 
                          {...register(`images.${index}.image_url`)}
                          placeholder="Image URL"
                          className="flex-1 px-4 py-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
                        />
                        <button 
                          type="button"
                          onClick={() => removeImage(index)}
                          className="p-2.5 text-foreground/20 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'variants' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white border border-border rounded-3xl p-8 shadow-sm space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Product Variants</h3>
                  <button 
                    type="button"
                    onClick={() => appendVariant({ label: '', mrp: 0, sale_price: 0, stock_qty: 0, is_default: false })}
                    className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/20 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add Variant
                  </button>
                </div>

                <div className="space-y-4">
                  {variantFields.map((field, index) => (
                    <div key={field.id} className="p-6 bg-surface/50 border border-border rounded-2xl space-y-4 relative group">
                      <button 
                        type="button"
                        onClick={() => removeVariant(index)}
                        className="absolute top-4 right-4 p-2 text-foreground/20 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">Label (e.g. 500g)</label>
                          <input 
                            {...register(`variants.${index}.label`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">Grams</label>
                          <input 
                            type="number"
                            {...register(`variants.${index}.grams`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">Size Code</label>
                          <input 
                            {...register(`variants.${index}.size_code`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">MRP</label>
                          <input 
                            type="number"
                            {...register(`variants.${index}.mrp`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">Sale Price</label>
                          <input 
                            type="number"
                            {...register(`variants.${index}.sale_price`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm font-bold text-primary"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-foreground/50">Stock</label>
                          <input 
                            type="number"
                            {...register(`variants.${index}.stock_qty`)}
                            className="w-full px-4 py-2 bg-white border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {variantFields.length === 0 && (
                    <div className="py-12 text-center bg-surface/30 border-2 border-dashed border-border rounded-3xl">
                      <Layers className="w-12 h-12 text-foreground/10 mx-auto mb-3" />
                      <p className="text-foreground/40 font-medium">No variants added yet.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'details' && (
              <div className="space-y-8">
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white border border-border rounded-3xl p-8 shadow-sm space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                      Product Highlights
                    </h3>
                    <button 
                      type="button"
                      onClick={() => appendHighlight({ highlight: '', sort_order: highlightFields.length })}
                      className="text-primary text-sm font-bold flex items-center gap-1.5 hover:underline"
                    >
                      <Plus className="w-4 h-4" /> Add Highlight
                    </button>
                  </div>

                  <div className="space-y-3">
                    {highlightFields.map((field, index) => (
                      <div key={field.id} className="flex gap-4 items-center group">
                        <div className="w-8 h-8 bg-surface rounded-lg flex items-center justify-center text-xs font-bold text-foreground/30 border border-border">
                          {index + 1}
                        </div>
                        <input 
                          {...register(`highlights.${index}.highlight`)}
                          placeholder="e.g. 100% Organic and fresh"
                          className="flex-1 px-5 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
                        />
                        <button 
                          type="button"
                          onClick={() => removeHighlight(index)}
                          className="p-2.5 text-foreground/20 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white border border-border rounded-3xl p-8 shadow-sm space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Activity className="w-5 h-5 text-green-500" />
                      Nutrition Information
                    </h3>
                    <button 
                      type="button"
                      onClick={() => appendNutrition({ nutrient: '', value: '', sort_order: nutritionFields.length })}
                      className="text-primary text-sm font-bold flex items-center gap-1.5 hover:underline"
                    >
                      <Plus className="w-4 h-4" /> Add Nutrient
                    </button>
                  </div>

                  <div className="space-y-4">
                    {nutritionFields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-2 md:grid-cols-[1fr_1fr_auto] gap-4 items-center">
                        <input 
                          {...register(`nutrition.${index}.nutrient`)}
                          placeholder="Nutrient (e.g. Protein)"
                          className="px-5 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
                        />
                        <input 
                          {...register(`nutrition.${index}.value`)}
                          placeholder="Value (e.g. 2.5g)"
                          className="px-5 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-bold"
                        />
                        <button 
                          type="button"
                          onClick={() => removeNutrition(index)}
                          className="p-2.5 text-foreground/20 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
