export default {
  async fetch(request, env) {
    const UPSTREAM_DNS_PROVIDERS = [
      'https://cloudflare-dns.com/dns-query',
      'https://dns.google/dns-query',
      'https://dns.quad9.net/dns-query',
      'https://doh.opendns.com/dns-query'
    ];

    const DNS_CACHE_TTL = 300;
    const REQUEST_TIMEOUT = 10000;
    const RATE_LIMIT_REQUESTS = 100;
    const RATE_LIMIT_WINDOW = 60000;

    const url = new URL(request.url);
    
    if (url.pathname === '/apple') {
      return generateAppleProfile(request.url);
    }
    
    if (url.pathname === '/dns-query') {
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      if (request.method === 'OPTIONS') {
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

      try {
        let dnsResponse;
        
        if (request.method === 'GET') {
          const dnsParam = url.searchParams.get('dns');
          
          if (!dnsParam) {
            throw new Error('Missing dns parameter');
          }

          if (!/^[A-Za-z0-9_-]+$/.test(dnsParam)) {
            throw new Error('Invalid dns parameter format');
          }

          for (let i = 0; i < UPSTREAM_DNS_PROVIDERS.length; i++) {
            try {
              const upstreamUrl = new URL(UPSTREAM_DNS_PROVIDERS[i]);
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
                dnsResponse = response;
                break;
              }
              
            } catch (error) {
              if (i === UPSTREAM_DNS_PROVIDERS.length - 1) {
                throw error;
              }
              continue;
            }
          }
        } else if (request.method === 'POST') {
          const contentType = request.headers.get('Content-Type');
          
          if (contentType !== 'application/dns-message') {
            throw new Error('Invalid Content-Type');
          }

          const body = await request.arrayBuffer();
          
          if (body.byteLength === 0 || body.byteLength > 512) {
            throw new Error('Invalid DNS message size');
          }

          for (let i = 0; i < UPSTREAM_DNS_PROVIDERS.length; i++) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
              
              const response = await fetch(UPSTREAM_DNS_PROVIDERS[i], {
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
                dnsResponse = response;
                break;
              }
              
            } catch (error) {
              if (i === UPSTREAM_DNS_PROVIDERS.length - 1) {
                throw error;
              }
              continue;
            }
          }
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
    
    return env.ASSETS.fetch(request);
  }
};

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
