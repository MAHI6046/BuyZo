part of '../pages/home_page.dart';

class _CatalogProduct {
  _CatalogProduct({
    required this.id,
    required this.name,
    required this.shortDescription,
    required this.description,
    required this.priceMrp,
    required this.priceSale,
    required this.discountPercent,
    required this.stockQty,
    required this.isVeg,
    required this.category,
    required this.brand,
    required this.images,
    required this.highlights,
    required this.nutrition,
    required this.variants,
    required this.similar,
  });

  factory _CatalogProduct.fromJson(Map<String, dynamic> json) {
    final imageUrls = <String>[];
    final images = json['images'];
    if (images is List) {
      for (final item in images) {
        if (item is Map<String, dynamic>) {
          final url = item['image_url']?.toString();
          if (url != null && url.isNotEmpty) imageUrls.add(url);
        }
      }
    }

    final primaryImageUrl = json['primary_image_url']?.toString();
    if (primaryImageUrl != null &&
        primaryImageUrl.isNotEmpty &&
        !imageUrls.contains(primaryImageUrl)) {
      imageUrls.insert(0, primaryImageUrl);
    }

    final parsedHighlights = <String>[];
    final highlightsJson = json['highlights'];
    if (highlightsJson is List) {
      for (final item in highlightsJson) {
        if (item is Map<String, dynamic>) {
          final text = item['highlight']?.toString();
          if (text != null && text.isNotEmpty) parsedHighlights.add(text);
        } else if (item != null) {
          final text = item.toString();
          if (text.isNotEmpty) parsedHighlights.add(text);
        }
      }
    }

    final parsedNutrition = <_NutritionRow>[];
    final nutritionJson = json['nutrition'];
    if (nutritionJson is List) {
      for (final row in nutritionJson) {
        if (row is Map<String, dynamic>) {
          final nutrient = row['nutrient']?.toString() ?? '';
          final value = row['value']?.toString() ?? '';
          if (nutrient.isNotEmpty && value.isNotEmpty) {
            parsedNutrition
                .add(_NutritionRow(nutrient: nutrient, value: value));
          }
        }
      }
    }

    final parsedVariants = <_ProductVariant>[];
    final variantsJson = json['variants'];
    if (variantsJson is List) {
      for (final variant in variantsJson) {
        if (variant is Map<String, dynamic>) {
          parsedVariants.add(_ProductVariant.fromJson(variant));
        }
      }
    }

    final parsedSimilar = <_CatalogProduct>[];
    final similarJson = json['similar'];
    if (similarJson is List) {
      for (final item in similarJson) {
        if (item is Map<String, dynamic>) {
          parsedSimilar.add(_CatalogProduct.fromJson(item));
        }
      }
    }

    return _CatalogProduct(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? 'Untitled',
      shortDescription: json['short_description']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      priceMrp: _asDouble(json['price_mrp']),
      priceSale: _asDouble(json['price_sale']),
      discountPercent: _asDouble(json['discount_percent']),
      stockQty: _asInt(json['stock_qty']),
      isVeg: json['is_veg'] == null ? null : json['is_veg'] == true,
      category: json['category']?.toString() ?? '',
      brand: json['brand']?.toString() ?? '',
      images: imageUrls,
      highlights: parsedHighlights,
      nutrition: parsedNutrition,
      variants: parsedVariants,
      similar: parsedSimilar,
    );
  }

  final int id;
  final String name;
  final String shortDescription;
  final String description;
  final double priceMrp;
  final double priceSale;
  final double discountPercent;
  final int stockQty;
  final bool? isVeg;
  final String category;
  final String brand;
  final List<String> images;
  final List<String> highlights;
  final List<_NutritionRow> nutrition;
  final List<_ProductVariant> variants;
  final List<_CatalogProduct> similar;

  String get displayImage => images.isNotEmpty ? images.first : '';
}

class _DisplayPricing {
  const _DisplayPricing({
    required this.primaryPrice,
    required this.mrp,
    required this.hasDiscount,
    required this.discountPercent,
  });

  final double primaryPrice;
  final double mrp;
  final bool hasDiscount;
  final double discountPercent;
}

_DisplayPricing _resolveDisplayPricing({
  required double mrp,
  required double sale,
}) {
  final safeMrp = mrp.isFinite ? mrp : 0.0;
  final safeSale = sale.isFinite ? sale : 0.0;
  final hasDiscount = safeMrp > 0 && safeSale > 0 && safeSale < safeMrp;
  final discountPercent =
      hasDiscount ? ((safeMrp - safeSale) / safeMrp) * 100.0 : 0.0;

  return _DisplayPricing(
    primaryPrice: hasDiscount ? safeSale : safeMrp,
    mrp: safeMrp,
    hasDiscount: hasDiscount,
    discountPercent: discountPercent,
  );
}

class _ProductVariant {
  _ProductVariant({
    required this.id,
    required this.label,
    required this.grams,
    required this.sizeCode,
    required this.mrp,
    required this.salePrice,
    required this.stockQty,
    required this.isDefault,
  });

  factory _ProductVariant.fromJson(Map<String, dynamic> json) {
    return _ProductVariant(
      id: _asInt(json['id']),
      label: json['label']?.toString() ?? '',
      grams: _asInt(json['grams']),
      sizeCode: json['size_code']?.toString() ?? '',
      mrp: _asDouble(json['mrp']),
      salePrice: _asDouble(json['sale_price']),
      stockQty: _asInt(json['stock_qty']),
      isDefault: json['is_default'] == true,
    );
  }

  final int id;
  final String label;
  final int grams;
  final String sizeCode;
  final double mrp;
  final double salePrice;
  final int stockQty;
  final bool isDefault;

  String get title {
    if (label.isNotEmpty) return label;
    if (grams > 0) return '$grams g';
    if (sizeCode.isNotEmpty) return sizeCode;
    return 'Variant';
  }
}

class _NutritionRow {
  _NutritionRow({required this.nutrient, required this.value});

  final String nutrient;
  final String value;
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _asDouble(Object? value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}
