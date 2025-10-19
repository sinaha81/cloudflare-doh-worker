const UPSTREAM_DNS_PROVIDERS = [

  { name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query", weight: 25, category: "عمومی و سریع", description: "تمرکز بر سرعت و حریم خصوصی، بدون ذخیره لاگ." },
  { name: "Google", url: "https://dns.google/dns-query", weight: 20, category: "عمومی و سریع", description: "پایداری و سرعت بالا در سراسر جهان." },
  { name: "Quad9", url: "https://dns.quad9.net/dns-query", weight: 20, category: "عمومی و سریع", description: "مسدودسازی دامنه‌های مخرب، فیشینگ و بدافزارها برای افزایش امنیت." },
  { name: "OpenDNS", url: "https://doh.opendns.com/dns-query", weight: 10, category: "عمومی و سریع", description: "یکی از قدیمی‌ترین و پایدارترین سرویس‌های DNS عمومی." },
  { name: "DNS4EU", url: "https://dns.dns4.eu/dns-query", weight: 15, category: "عمومی و سریع", description: "سرویس DNS عمومی اروپایی با تمرکز بر حریم خصوصی و امنیت." },
  { name: "AdGuard", url: "https://dns.adguard-dns.com/dns-query", weight: 15, category: "مسدودکننده تبلیغات", description: "مسدودسازی موثر تبلیغات، ردیاب‌ها و سایت‌های مخرب." }
];

const DNS_CACHE_TTL = 300;
const REQUEST_TIMEOUT = 10000;
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60000;
const rateLimitMap = new Map();
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});


async function handleRequest(request) {
  const url = new URL(request.url);
  
  if (url.pathname === '/apple') {
    return generateAppleProfile(request.url);
  }
  
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  
  if (!checkRateLimit(clientIP)) {
    return new Response('Rate limit exceeded. Please try again later.', {
      status: 429,
      headers: {
        'Content-Type': 'text/plain',
        'Retry-After': '60'
      }
    });
  }
  
  if (url.pathname !== '/dns-query') {
    const csp = "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;";
    return new Response(getHomePage(request.url), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': csp
      }
    });
  }

  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  try {
    let dnsResponse;
    
    if (request.method === 'GET') {
      dnsResponse = await handleGetRequest(url);
    } else if (request.method === 'POST') {
      dnsResponse = await handlePostRequest(request);
    } else {
      return new Response('Method not allowed', { 
        status: 405,
        headers: {
          'Allow': 'GET, POST, OPTIONS'
        }
      });
    }

    return new Response(dnsResponse.body, {
      status: dnsResponse.status,
      headers: {
        'Content-Type': 'application/dns-message',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': `public, max-age=${DNS_CACHE_TTL}`,
        'X-Content-Type-Options': 'nosniff',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
      }
    });
    
  } catch (error) {
    return new Response('DNS query failed: ' + error.message, { 
      status: 500,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
}



function selectProvider(providers) {
  const totalWeight = providers.reduce((sum, provider) => sum + provider.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const provider of providers) {
    if (random < provider.weight) {
      return provider;
    }
    random -= provider.weight;
  }
  
  return providers[0];
}

async function handleGetRequest(url) {
  const dnsParam = url.searchParams.get('dns');
  
  if (!dnsParam) {
    throw new Error('Missing dns parameter');
  }

  if (!isValidBase64Url(dnsParam)) {
    throw new Error('Invalid dns parameter format');
  }
  
  const selectedProvider = selectProvider(UPSTREAM_DNS_PROVIDERS);
  const fallbackProviders = UPSTREAM_DNS_PROVIDERS.filter(p => p.url !== selectedProvider.url);
  const providersToTry = [selectedProvider, ...fallbackProviders];

  for (const provider of providersToTry) {
    try {
      const upstreamUrl = new URL(provider.url);
      upstreamUrl.searchParams.set('dns', dnsParam);
      
      url.searchParams.forEach((value, key) => {
        if (key !== 'dns') {
          upstreamUrl.searchParams.set(key, value);
        }
      });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(upstreamUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/dns-message',
          'User-Agent': 'DoH-Proxy-Worker/1.0'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
    } catch (error) {
      console.error(`Failed to fetch from ${provider.name}: ${error.message}`);
      continue;
    }
  }

  throw new Error('All upstream DNS servers failed');
}

async function handlePostRequest(request) {
  const contentType = request.headers.get('Content-Type');
  
  if (contentType !== 'application/dns-message') {
    throw new Error('Invalid Content-Type. Expected application/dns-message');
  }

  const body = await request.arrayBuffer();
  
  if (body.byteLength === 0 || body.byteLength > 512) {
    throw new Error('Invalid DNS message size');
  }

  const selectedProvider = selectProvider(UPSTREAM_DNS_PROVIDERS);
  const fallbackProviders = UPSTREAM_DNS_PROVIDERS.filter(p => p.url !== selectedProvider.url);
  const providersToTry = [selectedProvider, ...fallbackProviders];

  for (const provider of providersToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dns-message',
          'Accept': 'application/dns-message',
          'User-Agent': 'DoH-Proxy-Worker/1.0'
        },
        body: body,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
    } catch (error) {
      console.error(`Failed to fetch from ${provider.name}: ${error.message}`);
      continue;
    }
  }
  
  throw new Error('All upstream DNS servers failed');
}



function generateAppleProfile(requestUrl) {
  const baseUrl = new URL(requestUrl);
  const dohUrl = `${baseUrl.protocol}//${baseUrl.hostname}/dns-query`;
  const hostname = baseUrl.hostname;
  
  const uuid1 = crypto.randomUUID();
  const uuid2 = crypto.randomUUID();
  const uuid3 = crypto.randomUUID();
  
  const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>DNSSettings</key>
            <dict>
                <key>DNSProtocol</key>
                <string>HTTPS</string>
                <key>ServerURL</key>
                <string>${dohUrl}</string>
            </dict>
            <key>PayloadDescription</key>
            <string>Configures device to use Anonymous DoH Proxy</string>
            <key>PayloadDisplayName</key>
            <string>Anonymous DoH Proxy</string>
            <key>PayloadIdentifier</key>
            <string>com.cloudflare.${uuid2}.dnsSettings.managed</string>
            <key>PayloadType</key>
            <string>com.apple.dnsSettings.managed</string>
            <key>PayloadUUID</key>
            <string>${uuid3}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>ProhibitDisablement</key>
            <false/>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>This profile enables encrypted DNS (DNS over HTTPS) on iOS, iPadOS, and macOS devices using your personal DoH Proxy.</string>
    <key>PayloadDisplayName</key>
    <string>Anonymous DoH Proxy - ${hostname}</string>
    <key>PayloadIdentifier</key>
    <string>com.cloudflare.${uuid1}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${uuid1}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

  return new Response(mobileconfig, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
      'Content-Disposition': `attachment; filename="doh-proxy-${hostname}.mobileconfig"`,
      'Cache-Control': 'no-cache'
    }
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function checkRateLimit(clientIP) {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientIP);
  
  if (!clientData) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (now > clientData.resetTime) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (clientData.count >= RATE_LIMIT_REQUESTS) {
    return false;
  }
  
  clientData.count++;
  return true;
}

function isValidBase64Url(str) {
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/;
  return base64UrlRegex.test(str);
}


function getHomePage(requestUrl) {
  const fullDohUrl = new URL('/dns-query', requestUrl).href;
  const appleProfileUrl = new URL('/apple', requestUrl).href;
  
  let dnsListHtml = '';
  UPSTREAM_DNS_PROVIDERS.forEach(provider => {
    dnsListHtml += `<li class="dns-item">
      <span class="dns-name">${provider.name}</span>
      <span class="dns-desc">${provider.description}</span>
    </li>`;
  });

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DoH Proxy - Aurora UI</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <style>
        :root {
            --bg-color: #010409;
            --container-bg: rgba(22, 27, 34, 0.75);
            --border-color: rgba(255, 255, 255, 0.1);
            --text-primary: #e6edf3;
            --text-secondary: #7d8590;
            --accent-color: #38bdf8; /* Sky Blue */
            --accent-hover: #7dd3fc; /* Lighter Sky Blue */
            --info-color: #316dca;
            --info-bg: rgba(56, 139, 253, 0.1);
            --info-border: rgba(56, 139, 253, 0.3);
            --warn-color: #f7b948;
            --warn-bg: rgba(247, 185, 72, 0.1);
            --warn-border: rgba(247, 185, 72, 0.3);
            --input-bg: #0d1117;
        }
        @keyframes aurora-bg {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        body {
            font-family: 'Vazirmatn', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 3rem 1rem;
            overflow-y: auto;
            position: relative;
        }
        body::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(125deg, #0d1117, #38bdf8, #0d1117, #58a6ff, #0d1117);
            background-size: 400% 400%;
            animation: aurora-bg 20s ease infinite;
            filter: blur(80px);
            opacity: 0.25;
            z-index: -1;
        }
        .container {
            max-width: 700px;
            width: 100%;
            background: var(--container-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            position: relative;
            z-index: 1;
        }
        .header { text-align: center; margin-bottom: 2.5rem; }
        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            letter-spacing: -1px;
            background: -webkit-linear-gradient(45deg, #c3d9ef, #ffffff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background-color: rgba(35, 134, 54, 0.15);
            color: #3fb950;
            padding: 0.3rem 0.8rem;
            border-radius: 99px;
            font-size: 0.9rem;
            font-weight: 500;
            border: 1px solid rgba(35, 134, 54, 0.3);
        }
        .status::before {
            content: '';
            width: 8px;
            height: 8px;
            background-color: #3fb950;
            border-radius: 50%;
            box-shadow: 0 0 8px #3fb950;
            animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        
        .section { margin-bottom: 2.5rem; }
        .section:last-child { margin-bottom: 0; }
        .section-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-color);
        }
        
        .url-box {
            display: flex;
            align-items: center;
            background-color: var(--input-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.5rem;
            direction: ltr;
        }
        .url-text {
            flex-grow: 1;
            padding: 0.5rem;
            font-family: monospace;
            font-size: 0.95rem;
            color: var(--accent-color);
            overflow-x: auto;
            white-space: nowrap;
        }
        .copy-btn {
            background-color: #21262d;
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
            padding: 0.6rem 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        .copy-btn:hover { background-color: #30363d; color: var(--text-primary); transform: scale(1.05); }
        .copy-btn:active { transform: scale(0.98); }

        .dns-list { list-style: none; padding: 0;}
        .dns-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 0.25rem;
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
            gap: 1rem;
            transition: background-color 0.2s;
        }
        .dns-item:hover { background-color: rgba(255,255,255,0.03); }
        .dns-item:last-child { border-bottom: none; }
        .dns-name { font-weight: 500; color: var(--text-primary); }
        .dns-desc { font-size: 0.9rem; color: var(--text-secondary); text-align: left; }
        
        .info-box, .warning-box {
            padding: 1rem;
            border-radius: 8px;
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        .info-box {
            background-color: var(--info-bg);
            border: 1px solid var(--info-border);
            border-right: 3px solid var(--accent-color);
        }
        .warning-box {
            background-color: var(--warn-bg);
            border: 1px solid var(--warn-border);
            border-right: 3px solid var(--warn-color);
        }
        .info-box ul {
            padding-right: 1.25rem;
            margin: 0;
            color: var(--text-secondary);
            line-height: 1.7;
        }
        .warning-box p { margin: 0; color: var(--warn-color); font-weight: 500; line-height: 1.6; }

        .code-box {
            position: relative;
            background-color: var(--input-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            font-family: monospace;
            font-size: 0.85em;
            max-height: 300px;
            overflow: auto;
        }
        .code-box pre { padding: 1rem; padding-top: 3rem; white-space: pre-wrap; word-wrap: break-word; color: #b3b3b3; }
        .code-box .copy-btn { position: absolute; top: 0.75rem; left: 0.75rem; z-index: 10; }
        
        .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .setting-item {
            display: flex;
            flex-direction: column;
        }
        .setting-item label {
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        .setting-item input {
            background-color: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 0.6rem 0.8rem;
            border-radius: 6px;
            font-family: monospace;
            font-size: 0.9rem;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .setting-item input:focus {
            outline: none;
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            body {
                padding: 1.5rem 0.5rem;
            }
            .container {
                padding: 1.5rem 1rem;
            }
            .header h1 {
                font-size: 2rem;
            }
            .section-title {
                font-size: 1.15rem;
            }
            .dns-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.25rem;
            }
            .dns-desc {
                text-align: right;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>DoH Proxy</h1>
            <div class="status">سرویس فعال است</div>
        </header>

        <section class="section">
            <h2 class="section-title">آدرس سرویس شما</h2>
            <div class="url-box">
                <span class="url-text" id="dohUrl">${fullDohUrl}</span>
                <button class="copy-btn" onclick="copyToClipboard('dohUrl', 'آدرس سرویس')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span>کپی</span>
                </button>
            </div>
        </section>

        <section class="section">
            <h2 class="section-title">کلاینت‌های Xray (v2rayNG و مشابه)</h2>
            <div class="info-box">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width: 24px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                <div>
                    <strong>پیش‌نیازها:</strong>
                    <ul>
                        <li>نسخه v2rayNG باید بالاتر از 1.10.23 باشد.</li>
                        <li>فایل‌های Geo (geoip.dat و geosite.dat) باید به آخرین نسخه ایران آپدیت شده باشند.</li>
                    </ul>
                </div>
            </div>

            <h3 class="section-title" style="font-size: 1.1rem; border: none; margin-bottom: 0.5rem;">تنظیمات پیشرفته (اختیاری)</h3>
             <div class="settings-grid">
                <div class="setting-item">
                    <label for="server-name">Server Name (SNI)</label>
                    <input type="text" id="server-name" value="www.mci.ir" oninput="updateXrayConfig()">
                </div>
                <div class="setting-item">
                    <label for="frag-packets">Fragment Packets</label>
                    <input type="text" id="frag-packets" value="1-1" oninput="updateXrayConfig()">
                </div>
                <div class="setting-item">
                    <label for="frag-length">Fragment Length</label>
                    <input type="text" id="frag-length" value="10-20" oninput="updateXrayConfig()">
                </div>
                <div class="setting-item">
                    <label for="frag-interval">Fragment Interval</label>
                    <input type="text" id="frag-interval" value="5-10" oninput="updateXrayConfig()">
                </div>
            </div>

            <div class="code-box">
                <button class="copy-btn" onclick="copyToClipboard('xrayConfig', 'کانفیگ Xray')"><span>کپی</span></button>
                <pre id="xrayConfig"></pre>
            </div>
        </section>

        <section class="section">
            <h2 class="section-title">سرورهای DNS استفاده شده</h2>
            <ul class="dns-list">${dnsListHtml}</ul>
        </section>

        <section class="section">
             <div class="warning-box">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width: 24px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                <p><strong>توجه:</strong> این سرویس فقط DNS را رمزنگاری می‌کند و جایگزین VPN برای عبور از فیلترینگ نیست.</p>
             </div>
        </section>
    </div>

    <script>
        function copyToClipboard(elementId, title) {
            const element = document.getElementById(elementId);
            const text = element.tagName.toLowerCase() === 'pre' ? element.textContent : element.innerText;
            
            navigator.clipboard.writeText(text).then(() => {
                Swal.fire({
                    toast: true,
                    position: 'bottom-start',
                    icon: 'success',
                    title: title + ' کپی شد.',
                    showConfirmButton: false,
                    timer: 2500,
                    timerProgressBar: true,
                    background: '#161b22',
                    color: '#e6edf3',
                    iconColor: '#3fb950'
                });
            }).catch(err => {
                 Swal.fire({
                    toast: true,
                    position: 'bottom-start',
                    icon: 'error',
                    title: 'خطا در کپی کردن!',
                    showConfirmButton: false,
                    timer: 2500,
                    timerProgressBar: true,
                    background: '#161b22',
                    color: '#e6edf3',
                    iconColor: '#f85149'
                });
            });
        }
        
        function updateXrayConfig() {
            const serverName = document.getElementById('server-name').value;
            const fragPackets = document.getElementById('frag-packets').value;
            const fragLength = document.getElementById('frag-length').value;
            const fragInterval = document.getElementById('frag-interval').value;
            const fullDohUrl = document.getElementById('dohUrl').innerText;

            const config = {
              "remarks": "personal-dns",
              "log": {
                "loglevel": "warning",
                "dnsLog": false,
                "access": "none"
              },
              "policy": {
                "levels": {
                  "0": {
                    "uplinkOnly": 0,
                    "downlinkOnly": 0
                  }
                }
              },
              "dns": {
                "hosts": {
                  "geosite:category-ads-all": "#3",
                  "cloudflare-dns.com": "www.cloudflare.com",
                  "dns.google": "www.google.com"
                },
                "servers": [
                  {
                    "address": "fakedns",
                    "domains": [
                      "domain:ir", "geosite:private", "geosite:ir", "domain:dynx.pro",
                      "geosite:sanctioned", "geosite:telegram", "geosite:meta", "geosite:youtube",
                      "geosite:twitter", "geosite:reddit", "geosite:twitch", "geosite:tiktok", "geosite:discord"
                    ],
                    "finalQuery": true
                  },
                  {
                    "tag": "personal-doh",
                    "address": fullDohUrl,
                    "domains": [
                      "geosite:telegram", "geosite:meta", "geosite:youtube", "geosite:twitter",
                      "geosite:reddit", "geosite:twitch", "geosite:tiktok", "geosite:discord", "geosite:sanctioned"
                    ],
                    "timeoutMs": 4000,
                    "finalQuery": true
                  },
                  {
                    "address": "localhost",
                    "domains": [ "domain:ir", "geosite:private", "geosite:ir" ],
                    "finalQuery": true
                  }
                ],
                "queryStrategy": "UseSystem",
                "useSystemHosts": true
              },
              "inbounds": [
                {
                  "tag": "dns-in", "listen": "127.0.0.1", "port": 10853, "protocol": "tunnel",
                  "settings": { "address": "127.0.0.1", "port": 53, "network": "tcp,udp" },
                  "streamSettings": { "sockopt": { "tcpKeepAliveInterval": 1, "tcpKeepAliveIdle": 46 } }
                },
                {
                  "tag": "socks-in", "listen": "127.0.0.1", "port": 10808, "protocol": "mixed",
                  "sniffing": { "enabled": true, "destOverride": [ "fakedns" ], "routeOnly": false },
                  "settings": { "udp": true, "ip": "127.0.0.1" },
                  "streamSettings": { "sockopt": { "tcpKeepAliveInterval": 1, "tcpKeepAliveIdle": 46 } }
                }
              ],
              "outbounds": [
                { "tag": "block-out", "protocol": "block" },
                {
                  "tag": "direct-out", "protocol": "direct",
                  "streamSettings": { "sockopt": { "happyEyeballs": { "tryDelayMs": 100 } } }
                },
                {
                  "tag": "dns-out", "protocol": "dns",
                  "settings": { "nonIPQuery": "reject", "blockTypes": [ 0, 65 ] }
                },
                {
                  "tag": "fragment-out", "protocol": "freedom",
                  "streamSettings": {
                    "sockopt": { "happyEyeballs": { "tryDelayMs": 200 } },
                    "tlsSettings": {
                      "serverName": serverName,
                      "alpn": [ "h3", "h2", "http/1.1" ],
                      "fingerprint": "randomized"
                    }
                  },
                  "settings": {
                    "fragment": {
                      "packets": fragPackets,
                      "length": fragLength,
                      "interval": fragInterval
                    },
                    "domainStrategy": "UseIPv4v6"
                  }
                },
                {
                  "tag": "udp-noises-out", "protocol": "direct",
                  "settings": { "targetStrategy": "ForceIP", "noises": new Array(10).fill({"type": "rand","packet": "1250","delay": "10","applyTo": "ipv4"}).concat(new Array(10).fill({"type": "rand","packet": "1230","delay": "10","applyTo": "ipv6"})) }
                }
              ],
              "routing": {
                "domainStrategy": "IPOnDemand",
                "rules": [
                  { "outboundTag": "block-out", "port": 0 },
                  { "outboundTag": "block-out", "domain": [ "geosite:category-ads-all" ] },
                  { "outboundTag": "block-out", "ip": [ "geoip:irgfw-block-injected-ips", "0.0.0.0", "::", "198.18.0.0/15", "fc00::/18" ] },
                  { "outboundTag": "dns-out", "inboundTag": [ "dns-in" ] },
                  { "outboundTag": "dns-out", "inboundTag": [ "socks-in" ], "port": 53 },
                  { "outboundTag": "fragment-out", "inboundTag": [ "personal-doh" ] },
                  { "outboundTag": "direct-out", "domain": [ "domain:ir", "geosite:private", "geosite:ir" ] },
                  { "outboundTag": "direct-out", "ip": [ "geoip:private", "geoip:ir" ] },
                  { "outboundTag": "udp-noises-out", "network": "udp", "protocol": [ "quic" ] },
                  { "outboundTag": "udp-noises-out", "network": "udp", "port": "443,2053,2083,2087,2096,8443" },
                  { "outboundTag": "direct-out", "network": "udp" },
                  { "outboundTag": "fragment-out", "network": "tcp", "protocol": [ "tls" ] },
                  { "outboundTag": "fragment-out", "network": "tcp", "port": "80,443,8080,8443,2052,2053,2082,2083,2086,2087,2095,2096" },
                  { "outboundTag": "fragment-out", "network": "tcp" },
                  { "outboundTag": "block-out", "network": "tcp,udp" }
                ]
              }
            };
            
            document.getElementById('xrayConfig').textContent = JSON.stringify(config, null, 2);
        }

        document.addEventListener('DOMContentLoaded', function() {
            updateXrayConfig();
        });
    </script>
</body>
</html>`;
}
