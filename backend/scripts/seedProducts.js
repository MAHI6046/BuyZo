const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { pool } = require('../src/db');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const products = [
  {
    name: 'India Gate Basmati Rice',
    slug: 'india-gate-basmati-rice',
    shortDescription: 'Premium long-grain basmati rice with rich aroma.',
    description:
      'Aged basmati rice ideal for biryani, pulao, and daily meals. Cooks fluffy with separate grains.',
    category: 'Rice & Grains',
    brand: 'India Gate',
    isVeg: true,
    priceMrp: 22.99,
    priceSale: 18.49,
    stockQty: 120,
    imageTopics: ['Basmati', 'Rice', 'Biryani'],
    images: [
      'https://cdn.pixabay.com/photo/2021/08/27/11/47/basmati-rice-6578507_1280.jpg',
      'https://images.pexels.com/photos/35553000/pexels-photo-35553000.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '1 kg', grams: 1000, sizeCode: '1kg', mrp: 5.99, salePrice: 4.99, stockQty: 140, isDefault: false },
      { label: '5 kg', grams: 5000, sizeCode: '5kg', mrp: 22.99, salePrice: 18.49, stockQty: 120, isDefault: true },
      { label: '10 kg', grams: 10000, sizeCode: '10kg', mrp: 43.99, salePrice: 36.99, stockQty: 80, isDefault: false },
    ],
    highlights: ['Naturally aromatic', 'Extra-long grain', 'Aged for better texture'],
    nutrition: [
      { nutrient: 'Energy', value: '356 kcal / 100g' },
      { nutrient: 'Carbohydrates', value: '78 g / 100g' },
      { nutrient: 'Protein', value: '8 g / 100g' },
    ],
  },
  {
    name: 'Aashirvaad Whole Wheat Atta',
    slug: 'aashirvaad-whole-wheat-atta',
    shortDescription: 'Stone-ground chakki atta for soft rotis.',
    description:
      'Whole wheat flour made from selected grains. Delivers soft rotis and balanced taste for everyday cooking.',
    category: 'Flour',
    brand: 'Aashirvaad',
    isVeg: true,
    priceMrp: 14.49,
    priceSale: 11.99,
    stockQty: 150,
    imageTopics: ['Whole wheat flour', 'Chapati', 'Wheat'],
    images: [
      'https://images.pexels.com/photos/6287223/pexels-photo-6287223.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1435904/pexels-photo-1435904.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '2 kg', grams: 2000, sizeCode: '2kg', mrp: 6.49, salePrice: 5.49, stockQty: 160, isDefault: false },
      { label: '5 kg', grams: 5000, sizeCode: '5kg', mrp: 14.49, salePrice: 11.99, stockQty: 150, isDefault: true },
      { label: '10 kg', grams: 10000, sizeCode: '10kg', mrp: 27.99, salePrice: 23.99, stockQty: 90, isDefault: false },
    ],
    highlights: ['100% whole wheat', 'Chakki ground', 'No maida added'],
    nutrition: [
      { nutrient: 'Energy', value: '364 kcal / 100g' },
      { nutrient: 'Protein', value: '12 g / 100g' },
      { nutrient: 'Dietary Fiber', value: '11 g / 100g' },
    ],
  },
  {
    name: 'Tata Sampann Toor Dal',
    slug: 'tata-sampann-toor-dal',
    shortDescription: 'Unpolished arhar dal, rich in protein.',
    description:
      'Everyday toor dal with natural flavor and high protein. Great for sambar and dal tadka.',
    category: 'Pulses',
    brand: 'Tata Sampann',
    isVeg: true,
    priceMrp: 8.99,
    priceSale: 7.29,
    stockQty: 180,
    imageTopics: ['Pigeon pea', 'Dal', 'Lentil'],
    images: [
      'https://images.pexels.com/photos/8108209/pexels-photo-8108209.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/6823599/pexels-photo-6823599.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1367242/pexels-photo-1367242.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '500 g', grams: 500, sizeCode: '500g', mrp: 4.99, salePrice: 3.99, stockQty: 200, isDefault: false },
      { label: '1 kg', grams: 1000, sizeCode: '1kg', mrp: 8.99, salePrice: 7.29, stockQty: 180, isDefault: true },
    ],
    highlights: ['Unpolished dal', 'Good source of protein', 'Quick cooking'],
    nutrition: [
      { nutrient: 'Energy', value: '343 kcal / 100g' },
      { nutrient: 'Protein', value: '22 g / 100g' },
      { nutrient: 'Fiber', value: '15 g / 100g' },
    ],
  },
  {
    name: 'Fortune Chana Dal',
    slug: 'fortune-chana-dal',
    shortDescription: 'Split Bengal gram with rich nutty taste.',
    description:
      'Quality chana dal suitable for dal fry, chana dal khichdi, and snacks.',
    category: 'Pulses',
    brand: 'Fortune',
    isVeg: true,
    priceMrp: 7.49,
    priceSale: 6.19,
    stockQty: 165,
    imageTopics: ['Chana dal', 'Chickpea', 'Dal'],
    images: [
      'https://images.pexels.com/photos/6823599/pexels-photo-6823599.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/8108209/pexels-photo-8108209.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1367242/pexels-photo-1367242.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '500 g', grams: 500, sizeCode: '500g', mrp: 4.29, salePrice: 3.49, stockQty: 175, isDefault: false },
      { label: '1 kg', grams: 1000, sizeCode: '1kg', mrp: 7.49, salePrice: 6.19, stockQty: 165, isDefault: true },
    ],
    highlights: ['Uniform grain size', 'Naturally rich in protein', 'Great for everyday meals'],
    nutrition: [
      { nutrient: 'Energy', value: '360 kcal / 100g' },
      { nutrient: 'Protein', value: '20 g / 100g' },
      { nutrient: 'Carbohydrates', value: '61 g / 100g' },
    ],
  },
  {
    name: 'Dabur Cold Pressed Mustard Oil',
    slug: 'dabur-cold-pressed-mustard-oil',
    shortDescription: 'Pungent mustard oil for authentic Indian cooking.',
    description:
      'Cold-pressed mustard oil with strong aroma, ideal for pickles, stir-fries, and Bengali dishes.',
    category: 'Oils & Ghee',
    brand: 'Dabur',
    isVeg: true,
    priceMrp: 12.99,
    priceSale: 10.49,
    stockQty: 90,
    imageTopics: ['Mustard oil', 'Cooking oil', 'Mustard'],
    images: [
      'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1435904/pexels-photo-1435904.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '1 L', grams: null, sizeCode: '1l', mrp: 12.99, salePrice: 10.49, stockQty: 90, isDefault: true },
      { label: '2 L', grams: null, sizeCode: '2l', mrp: 24.99, salePrice: 20.99, stockQty: 60, isDefault: false },
    ],
    highlights: ['Cold pressed', 'Strong natural aroma', 'Ideal for pickling'],
    nutrition: [
      { nutrient: 'Energy', value: '900 kcal / 100g' },
      { nutrient: 'Total Fat', value: '100 g / 100g' },
      { nutrient: 'Trans Fat', value: '0 g / 100g' },
    ],
  },
  {
    name: 'Amul Pure Cow Ghee',
    slug: 'amul-pure-cow-ghee',
    shortDescription: 'Aromatic pure ghee for daily cooking and sweets.',
    description:
      'Traditional clarified butter with rich aroma and taste. Perfect for tadka, halwa, and rotis.',
    category: 'Oils & Ghee',
    brand: 'Amul',
    isVeg: true,
    priceMrp: 10.99,
    priceSale: 9.19,
    stockQty: 110,
    imageTopics: ['Ghee', 'Clarified butter', 'Butter'],
    images: [
      'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1435904/pexels-photo-1435904.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '500 ml', grams: null, sizeCode: '500ml', mrp: 10.99, salePrice: 9.19, stockQty: 110, isDefault: true },
      { label: '1 L', grams: null, sizeCode: '1l', mrp: 20.99, salePrice: 17.99, stockQty: 70, isDefault: false },
    ],
    highlights: ['Pure cow ghee', 'Rich aroma', 'Traditional taste'],
    nutrition: [
      { nutrient: 'Energy', value: '897 kcal / 100g' },
      { nutrient: 'Total Fat', value: '99.8 g / 100g' },
      { nutrient: 'Saturated Fat', value: '60 g / 100g' },
    ],
  },
  {
    name: 'Everest Garam Masala',
    slug: 'everest-garam-masala',
    shortDescription: 'Classic Indian spice blend for curries and gravies.',
    description:
      'Aromatic masala blend made from selected spices to add warmth and depth to Indian dishes.',
    category: 'Spices',
    brand: 'Everest',
    isVeg: true,
    priceMrp: 4.49,
    priceSale: 3.79,
    stockQty: 220,
    imageTopics: ['Garam masala', 'Masala', 'Indian cuisine'],
    images: [
      'https://cdn.pixabay.com/photo/2020/01/13/19/46/garam-masala-4763363_1280.jpg',
      'https://images.pexels.com/photos/32144883/pexels-photo-32144883.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1367242/pexels-photo-1367242.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '100 g', grams: 100, sizeCode: '100g', mrp: 2.49, salePrice: 1.99, stockQty: 250, isDefault: false },
      { label: '200 g', grams: 200, sizeCode: '200g', mrp: 4.49, salePrice: 3.79, stockQty: 220, isDefault: true },
    ],
    highlights: ['Authentic blend', 'Strong aroma', 'No artificial colors'],
    nutrition: [
      { nutrient: 'Energy', value: '302 kcal / 100g' },
      { nutrient: 'Protein', value: '11 g / 100g' },
      { nutrient: 'Fiber', value: '28 g / 100g' },
    ],
  },
  {
    name: 'Organic Jaggery Powder',
    slug: 'organic-jaggery-powder',
    shortDescription: 'Natural unrefined sweetener from sugarcane.',
    description:
      'Fine jaggery powder that dissolves quickly. Great for tea, sweets, and healthy desserts.',
    category: 'Sweeteners',
    brand: '24 Mantra',
    isVeg: true,
    priceMrp: 6.99,
    priceSale: 5.59,
    stockQty: 140,
    imageTopics: ['Jaggery', 'Panela', 'Cane sugar'],
    images: [
      'https://images.pexels.com/photos/35766359/pexels-photo-35766359.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/35553000/pexels-photo-35553000.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/1367242/pexels-photo-1367242.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { label: '500 g', grams: 500, sizeCode: '500g', mrp: 3.99, salePrice: 3.19, stockQty: 150, isDefault: false },
      { label: '1 kg', grams: 1000, sizeCode: '1kg', mrp: 6.99, salePrice: 5.59, stockQty: 140, isDefault: true },
    ],
    highlights: ['Unrefined sweetener', 'No sulphur processing', 'Rich caramel flavor'],
    nutrition: [
      { nutrient: 'Energy', value: '383 kcal / 100g' },
      { nutrient: 'Carbohydrates', value: '98 g / 100g' },
      { nutrient: 'Iron', value: '11 mg / 100g' },
    ],
  },
];

async function fetchWikiThumbnail(topic, size = 1200) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageimages',
    pithumbsize: String(size),
    titles: topic,
    redirects: '1',
  });
  const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'dot-backend-seeder/1.0 (product image matching)',
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const pages = data?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const first = Object.values(pages)[0];
  if (!first || typeof first !== 'object') return null;
  return first.thumbnail?.source || null;
}

async function resolveProductImages(product) {
  const resolved = [];
  const topics = Array.isArray(product.imageTopics) ? product.imageTopics : [];

  for (const topic of topics) {
    try {
      const url = await fetchWikiThumbnail(topic);
      if (url && !resolved.includes(url)) {
        resolved.push(url);
      }
    } catch (_error) {
      // ignore and fallback to static urls below
    }
  }

  for (const fallbackUrl of product.images) {
    if (fallbackUrl && !resolved.includes(fallbackUrl)) {
      resolved.push(fallbackUrl);
    }
  }

  return resolved.slice(0, 3);
}

async function upsertProduct(client, product) {
  const productRes = await client.query(
    `
      INSERT INTO products (
        slug, name, short_description, description, category, brand,
        is_veg, is_active, price_mrp, price_sale, stock_qty, primary_image_url
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        short_description = EXCLUDED.short_description,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        brand = EXCLUDED.brand,
        is_veg = EXCLUDED.is_veg,
        is_active = EXCLUDED.is_active,
        price_mrp = EXCLUDED.price_mrp,
        price_sale = EXCLUDED.price_sale,
        stock_qty = EXCLUDED.stock_qty,
        primary_image_url = EXCLUDED.primary_image_url,
        updated_at = NOW()
      RETURNING id
    `,
    [
      product.slug,
      product.name,
      product.shortDescription,
      product.description,
      product.category,
      product.brand,
      product.isVeg,
      product.priceMrp,
      product.priceSale,
      product.stockQty,
      product.images[0] || null,
    ],
  );

  return productRes.rows[0].id;
}

async function replaceChildRows(client, productId, product) {
  await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
  await client.query('DELETE FROM product_highlights WHERE product_id = $1', [productId]);
  await client.query('DELETE FROM product_nutrition WHERE product_id = $1', [productId]);

  for (let i = 0; i < product.images.length; i += 1) {
    await client.query(
      `INSERT INTO product_images (product_id, image_url, sort_order) VALUES ($1,$2,$3)`,
      [productId, product.images[i], i],
    );
  }

  for (let i = 0; i < product.variants.length; i += 1) {
    const variant = product.variants[i];
    await client.query(
      `
        INSERT INTO product_variants (
          product_id, label, grams, size_code, mrp, sale_price, stock_qty, is_default
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        productId,
        variant.label,
        variant.grams,
        variant.sizeCode,
        variant.mrp,
        variant.salePrice,
        variant.stockQty,
        variant.isDefault === true,
      ],
    );
  }

  for (let i = 0; i < product.highlights.length; i += 1) {
    await client.query(
      `INSERT INTO product_highlights (product_id, highlight, sort_order) VALUES ($1,$2,$3)`,
      [productId, product.highlights[i], i],
    );
  }

  for (let i = 0; i < product.nutrition.length; i += 1) {
    const row = product.nutrition[i];
    await client.query(
      `INSERT INTO product_nutrition (product_id, nutrient, value, sort_order) VALUES ($1,$2,$3,$4)`,
      [productId, row.nutrient, row.value, i],
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);

    await client.query('BEGIN');
    for (const product of products) {
      const resolvedImages = await resolveProductImages(product);
      const payload = {
        ...product,
        images: resolvedImages.length > 0 ? resolvedImages : product.images,
      };
      const productId = await upsertProduct(client, payload);
      await replaceChildRows(client, productId, payload);
    }
    await client.query('COMMIT');
    console.log(`Seeded ${products.length} products.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
