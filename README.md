# 🔒 Cloudflare DoH Proxy

یک DoH (DNS over HTTPS) Proxy قدرتمند و امن با استفاده از Cloudflare Workers - کاملاً رایگان!

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)
[![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-green.svg)](https://pages.github.com/)

## 📖 توضیحات

این پروژه یک DoH Proxy حرفه‌ای است که با استفاده از Cloudflare Workers ساخته شده و امکان رمزنگاری کامل DNS queries شما را فراهم می‌کند. این سرویس از 4 سرور DNS معتبر استفاده می‌کند و در صورت عدم دسترسی به یکی، به صورت خودکار به سرور بعدی متصل می‌شود.

## ✨ ویژگی‌ها

- 🔐 **رمزنگاری کامل DNS**: تمام درخواست‌های DNS شما رمزنگاری می‌شود
- ⚡ **Fallback خودکار**: استفاده از 4 سرور DNS با قابلیت جایگزینی خودکار
- 🛡️ **امنیت بالا**: 
  - Rate Limiting (100 درخواست در دقیقه)
  - Input Validation
  - Security Headers
  - Request Timeout (10 ثانیه)
- 💰 **کاملاً رایگان**: تا 100,000 درخواست در روز
- 🌍 **سریع**: استفاده از شبکه جهانی Cloudflare CDN
- 📱 **سازگار با همه دستگاه‌ها**: مرورگرها، موبایل، ویندوز، مک
- 🇮🇷 **مناسب ایران**: برای رمزنگاری DNS و افزایش امنیت

## 🚀 نصب سریع

### مرحله 1: ایجاد Cloudflare Worker

1. به [dash.cloudflare.com](https://dash.cloudflare.com) بروید و وارد شوید
2. از منوی سمت چپ **Workers & Pages** را انتخاب کنید
3. روی **Create Application** کلیک کنید
4. **Create Worker** را انتخاب کنید
5. یک نام برای Worker انتخاب کنید (مثلاً `my-doh-proxy`)
6. روی **Deploy** کلیک کنید

### مرحله 2: کپی کردن کد

1. روی **Edit Code** کلیک کنید
2. تمام کد پیش‌فرض را پاک کنید
3. محتوای فایل [`worker.js`](worker.js) را کپی کرده و جایگذاری کنید
4. روی **Save and Deploy** کلیک کنید

### مرحله 3: دریافت URL

بعد از Deploy، URL شما به این شکل خواهد بود:

```
https://your-worker-name.your-subdomain.workers.dev/dns-query
```

این URL را در مرورگر یا دستگاه خود به عنوان DoH استفاده کنید.

## 📱 نحوه استفاده

### مرورگر Firefox

```
Settings → Privacy & Security → DNS over HTTPS
→ Choose provider: Custom
→ URL: https://your-worker.workers.dev/dns-query
```

### مرورگر Chrome/Edge/Brave

```
Settings → Privacy and security → Security
→ Use secure DNS → Custom
→ URL: https://your-worker.workers.dev/dns-query
```

### اپلیکیشن Intra (اندروید)

1. [Intra](https://play.google.com/store/apps/details?id=app.intra) را از Google Play نصب کنید
2. اپلیکیشن را باز کنید
3. روی **Configure custom server URL** بزنید
4. URL خود را وارد کنید
5. دکمه **ON** را فعال کنید

### ویندوز 11

```
Settings → Network & Internet → Properties
→ DNS server assignment → Edit
→ Preferred DNS encryption: Encrypted only (DNS over HTTPS)
→ URL: https://your-worker.workers.dev/dns-query
```

### iOS/macOS

نیاز به نصب پروفایل DoH یا استفاده از اپلیکیشن‌های شخص ثالث دارد.

## 🌐 سرورهای DNS استفاده شده

این DoH Proxy از 4 سرور DNS معتبر استفاده می‌کند:

1. **Cloudflare DNS** (1.1.1.1)
2. **Google DNS** (8.8.8.8)
3. **Quad9 DNS** (9.9.9.9)
4. **OpenDNS**

اگر یک سرور در دسترس نباشد، به صورت خودکار به سرور بعدی متصل می‌شود.

## ⚙️ تنظیمات پیشرفته

### تغییر Upstream DNS

می‌توانید لیست سرورهای DNS را در فایل `worker.js` تغییر دهید:

```javascript
const UPSTREAM_DNS_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
  'https://dns.quad9.net/dns-query',
  'https://doh.opendns.com/dns-query'
];
```

### تغییر Rate Limit

```javascript
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60000;
```

### تغییر Cache TTL

```javascript
const DNS_CACHE_TTL = 300;
```

## 🧪 تست کردن

برای تست Worker خود:

### روش 1: مرورگر

به آدرس اصلی Worker بروید (بدون `/dns-query`):

```
https://your-worker.workers.dev
```

اگر صفحه با وضعیت "فعال و آماده به کار" نمایش داده شد، همه چیز درست کار می‌کند.

### روش 2: cURL

```bash
curl -H 'accept: application/dns-json' \
  'https://your-worker.workers.dev/dns-query?name=google.com&type=A'
```

## 📊 محدودیت‌ها

### Cloudflare Workers Free Plan:

- ✅ 100,000 درخواست در روز
- ✅ 10ms CPU time per request
- ✅ بدون محدودیت bandwidth

این مقادیر برای استفاده شخصی کاملاً کافی است!

## ⚠️ نکات مهم

- این سرویس **فقط DNS queries** را رمزنگاری می‌کند
- برای دسترسی به سایت‌های فیلتر شده، از **VPN** استفاده کنید
- این سرویس جایگزین VPN نیست
- برای امنیت بیشتر، از HTTPS برای تمام سایت‌ها استفاده کنید

## 🤝 مشارکت

مشارکت شما در این پروژه خوشایند است!

1. این Repository را Fork کنید
2. یک Branch جدید بسازید (`git checkout -b feature/amazing-feature`)
3. تغییرات خود را Commit کنید (`git commit -m 'Add amazing feature'`)
4. Branch را Push کنید (`git push origin feature/amazing-feature`)
5. یک Pull Request باز کنید

## 📝 مجوز

این پروژه تحت مجوز MIT منتشر شده است. برای اطلاعات بیشتر فایل [LICENSE](LICENSE) را مشاهده کنید.

## 🔗 لینک‌های مفید

- [مستندات Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [RFC 8484 - DNS over HTTPS](https://datatracker.ietf.org/doc/html/rfc8484)
- [Cloudflare DNS](https://1.1.1.1/)
- [اپلیکیشن Intra](https://getintra.org/)

## 💬 پشتیبانی

اگر مشکلی دارید یا سوالی دارید:

- یک [Issue](https://github.com/yourusername/cloudflare-doh-proxy/issues) باز کنید
- به [Discussions](https://github.com/yourusername/cloudflare-doh-proxy/discussions) بپیوندید

## 👨‍💻 سازنده

طراحی و توسعه توسط: [Anonymous](https://t.me/BXAMbot)

---

⭐ اگر این پروژه برای شما مفید بود، یک ستاره به آن بدهید!

🔒 برای اینترنت آزاد و امن
