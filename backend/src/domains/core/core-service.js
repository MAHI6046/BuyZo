function createCoreService({ db, config }) {
  const {
    deepLinkScheme,
    androidStoreUrl,
    iosStoreUrl,
    defaultFallbackUrl,
    adminPortalUrl,
  } = config;

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const renderSharePage = ({
    title,
    description,
    imageUrl = '',
    deepLinkUrl,
    fallbackUrl = defaultFallbackUrl,
    ctaLabel = 'Open in app',
  }) => {
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeImage = escapeHtml(imageUrl);
    const safeDeepLink = escapeHtml(deepLinkUrl);
    const safeFallback = escapeHtml(fallbackUrl);
    const safeCta = escapeHtml(ctaLabel);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:type" content="website" />
  ${safeImage ? `<meta property="og:image" content="${safeImage}" />` : ''}
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #faf6f2; color: #211d18; }
    .wrap { max-width: 520px; margin: 0 auto; padding: 28px 16px 40px; }
    .card { background: #fff; border: 1px solid #eadfcf; border-radius: 16px; padding: 18px; box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
    .img { width: 100%; max-height: 260px; object-fit: cover; border-radius: 12px; background: #f4ece2; margin-bottom: 12px; }
    h1 { font-size: 22px; margin: 0 0 8px; line-height: 1.25; }
    p { margin: 0; color: #53483c; line-height: 1.45; }
    .actions { display: flex; gap: 10px; margin-top: 16px; }
    .btn { display: inline-block; text-decoration: none; border-radius: 12px; padding: 12px 14px; font-weight: 700; text-align: center; flex: 1; }
    .btn-primary { background: #ff9800; color: #fff; }
    .btn-secondary { background: #fff; color: #5c4d3b; border: 1px solid #e6d8c6; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      ${safeImage ? `<img class="img" src="${safeImage}" alt="${safeTitle}" />` : ''}
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <div class="actions">
        <a class="btn btn-primary" href="${safeDeepLink}" id="open-app">${safeCta}</a>
        <a class="btn btn-secondary" href="${safeFallback}">Get app</a>
      </div>
    </div>
  </div>
  <script>
    (function() {
      var isAndroid = /android/i.test(navigator.userAgent);
      var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var fallback = ${JSON.stringify(fallbackUrl)};
      if (isAndroid) fallback = ${JSON.stringify(androidStoreUrl)};
      if (isIos) fallback = ${JSON.stringify(iosStoreUrl)};
      var opened = false;
      var openButton = document.getElementById('open-app');
      var tryOpen = function() {
        if (opened) return;
        opened = true;
        window.location.href = ${JSON.stringify(deepLinkUrl)};
        setTimeout(function() {
          window.location.href = fallback;
        }, 1200);
      };
      openButton.addEventListener('click', function() {
        setTimeout(function() { opened = true; }, 50);
      });
      setTimeout(tryOpen, 250);
    })();
  </script>
</body>
</html>`;
  };

  async function getRootStatus() {
    return {
      type: 'json',
      status: 200,
      body: { ok: true, service: 'dot-backend', message: 'Backend is running' },
    };
  }

  async function getAdminEntry() {
    if (adminPortalUrl) {
      return { type: 'redirect', status: 302, location: adminPortalUrl };
    }
    return {
      type: 'json',
      status: 200,
      body: {
        ok: true,
        message:
          'Admin portal moved to Next.js App Router. Set ADMIN_PORTAL_URL to redirect /admin.',
      },
    };
  }

  async function getProductSharePage(rawProductId) {
    const productId = Number.parseInt(String(rawProductId || ''), 10);
    if (!Number.isInteger(productId) || productId <= 0) {
      return { type: 'redirect', status: 302, location: defaultFallbackUrl };
    }

    const productRes = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.short_description,
        COALESCE(
          NULLIF(TRIM(p.primary_image_url), ''),
          (
            SELECT pi.image_url
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.sort_order ASC, pi.id ASC
            LIMIT 1
          )
        ) AS image_url
      FROM products p
      WHERE p.id = $1
      LIMIT 1
      `,
      [productId],
    );

    if (productRes.rowCount === 0) {
      return { type: 'redirect', status: 302, location: defaultFallbackUrl };
    }

    const row = productRes.rows[0];
    const imageUrl = String(row.image_url || '').trim();

    const title = row.name ? `${row.name} • DOT Delivery` : 'DOT Delivery Product';
    const description =
      String(row.short_description || '').trim() || 'Tap to view this product in DOT Delivery.';
    const deepLinkUrl = `${deepLinkScheme}://product/${productId}`;

    return {
      type: 'html',
      status: 200,
      html: renderSharePage({
        title,
        description,
        imageUrl,
        deepLinkUrl,
        ctaLabel: 'Open product in app',
      }),
    };
  }

  async function getReferralSharePage(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    const title = 'DOT Delivery Invite';
    const description = code
      ? `Use invite code ${code} to claim your referral delivery credits.`
      : 'Join DOT Delivery and claim referral delivery credits.';
    const deepLinkUrl = code
      ? `${deepLinkScheme}://ref?code=${encodeURIComponent(code)}`
      : `${deepLinkScheme}://ref`;
    const fallbackUrl = code
      ? `${defaultFallbackUrl}/ref?code=${encodeURIComponent(code)}`
      : `${defaultFallbackUrl}/ref`;

    return {
      type: 'html',
      status: 200,
      html: renderSharePage({
        title,
        description,
        deepLinkUrl,
        fallbackUrl,
        ctaLabel: 'Open invite in app',
      }),
    };
  }

  async function getHealth() {
    const result = await db.query('SELECT NOW() AS now');
    return {
      type: 'json',
      status: 200,
      body: { ok: true, dbTime: result.rows[0].now },
    };
  }

  return {
    getRootStatus,
    getAdminEntry,
    getProductSharePage,
    getReferralSharePage,
    getHealth,
  };
}

module.exports = {
  createCoreService,
};
