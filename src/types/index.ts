export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url?: string | null;
  is_active: boolean;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  description: string;
  category: string;
  brand: string;
  is_veg: boolean;
  is_active: boolean;
  price_mrp: number;
  price_sale: number;
  discount_percent: number;
  stock_qty: number;
  primary_image_url: string;
  category_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  image_url: string;
  sort_order: number;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  grams?: number;
  size_code?: string;
  mrp: number;
  sale_price: number;
  stock_qty: number;
  is_default: boolean;
}

export interface ProductHighlight {
  id: string;
  product_id: string;
  highlight: string;
  sort_order: number;
}

export interface ProductNutrition {
  id: string;
  product_id: string;
  nutrient: string;
  value: string;
  sort_order: number;
}

export interface FullProduct extends Product {
  images: ProductImage[];
  variants: ProductVariant[];
  highlights: ProductHighlight[];
  nutrition: ProductNutrition[];
}
