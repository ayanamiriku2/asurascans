# Asura Scans Mirror

Full reverse-proxy mirror untuk `asurascans.com` — Node.js/Express.  
Deploy di **Railway**, **Render**, **VPS**, atau Docker host manapun.

## Masalah GSC yang Ditangani

| Masalah GSC | Solusi |
|---|---|
| Duplikat, Google memilih versi kanonis yang berbeda | Setiap halaman HTML mendapatkan `<link rel="canonical">` yang mengarah ke domain mirror |
| Tidak ditemukan (404) | Proxy meneruskan path asli 1:1, tidak ada URL yang hilang |
| Halaman dengan pengalihan | Redirect `Location` header di-rewrite ke domain mirror |
| Data terstruktur Breadcrumb | JSON-LD breadcrumb diperbaiki: URL, `@type`, `position` semua di-rewrite |
| Data terstruktur tidak dapat diurai | JSON-LD yang rusak dihapus otomatis agar tidak muncul error di GSC |
| robots.txt / Sitemap | Di-generate ulang dengan URL mirror |

## Fitur

- **Full HTML rewriting** — semua `href`, `src`, `srcset`, `data-src`, inline styles, inline scripts
- **Canonical tag** — dihapus semua duplikat, ditambahkan satu canonical yang benar
- **JSON-LD / Structured Data** — deep rewrite semua URL di dalam structured data
- **Meta OG/Twitter** — `og:url`, `og:image`, `twitter:url` di-rewrite
- **Redirect handling** — 3xx redirects di-rewrite ke mirror
- **Cookie domain** — `Set-Cookie` domain di-rewrite
- **Sitemap proxy** — fetch sitemap dari origin, rewrite semua URL
- **robots.txt** — auto-generate dengan link sitemap mirror
- **Gzip/Brotli** — dekompresi otomatis untuk rewriting

## Environment Variables

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |
| `ORIGIN_HOST` | `asurascans.com` | Domain asli yang di-mirror |
| `MIRROR_HOST` | *(auto dari Host header)* | Domain mirror kamu. Set ini jika pakai custom domain |

## Deploy

### Railway

```bash
railway login
railway init
railway up
```

Set env `MIRROR_HOST` ke domain Railway kamu (misal `xxx.up.railway.app`).

### Render

Push repo ke GitHub, lalu di Render → **New Web Service** → connect repo.  
Config sudah ada di `render.yaml`.

### VPS (Docker)

```bash
docker build -t asura-mirror .
docker run -d -p 80:3000 \
  -e ORIGIN_HOST=asurascans.com \
  -e MIRROR_HOST=yourdomain.com \
  asura-mirror
```

### VPS (langsung)

```bash
npm install
PORT=3000 MIRROR_HOST=yourdomain.com node server.js
```

Pakai **nginx** / **caddy** di depannya untuk SSL.

## Tips SEO

1. Set `MIRROR_HOST` ke domain custom kamu
2. Submit `https://yourdomain.com/sitemap.xml` ke Google Search Console
3. Cek canonical: `curl -s https://yourdomain.com/ | grep canonical`
4. Jangan jalankan 2 mirror di domain berbeda — duplikat