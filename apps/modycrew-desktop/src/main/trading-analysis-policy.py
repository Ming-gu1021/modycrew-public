"""Application transport policy; no provider requests at import time."""
import json, threading, time
from datetime import datetime, timezone
from urllib.parse import urlsplit

DATA_HOSTS = {
    'yfinance': {'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'fc.yahoo.com', 'finance.yahoo.com', 'consent.yahoo.com', 'guce.yahoo.com'},
    'reddit': {'www.reddit.com'},
    'stocktwits': {'api.stocktwits.com'},
}

class RequestPolicy:
    def __init__(self, config):
        self.config = config
        self.allowed = {'api.openai.com'}
        for vendor in config['dataProviders']:
            self.allowed.update(DATA_HOSTS[vendor])
        self.lock = threading.Lock()
        self.requests = 0
        self.model_calls = 0
        self.reserved_usd = 0.0
        self.blocked = 0
        self.sources = []
        self.start = time.monotonic()

    def before(self, url, method='GET', body=b''):
        with self.lock:
            try:
                u = urlsplit(str(url))
                if u.scheme != 'https' or u.hostname not in self.allowed or u.username or u.password or u.port not in (None,443):
                    raise PermissionError('Unapproved provider endpoint')
                if self.requests >= self.config['limits']['maxRequests'] or time.monotonic()-self.start > self.config['limits']['maxSeconds']:
                    raise PermissionError('Request or time limit exceeded')
                if isinstance(body,str): body=body.encode()
                if len(body)>131072: raise PermissionError('Request body limit exceeded')
                if u.hostname == 'api.openai.com':
                    if method.upper()!='POST' or u.path not in ('/v1/chat/completions','/v1/responses'):
                        raise PermissionError('Only model inference endpoints are allowed')
                    data=json.loads(body)
                    model=data.get('model')
                    candidates=[self.config[k] for k in ('quick','deep') if self.config[k]['model']==model]
                    rates={'inputUsdPerMillion':max(x['inputUsdPerMillion'] for x in candidates),'outputUsdPerMillion':max(x['outputUsdPerMillion'] for x in candidates)} if candidates else None
                    if not rates or data.get('stream') or any(t.get('type')!='function' for t in data.get('tools',[])):
                        raise PermissionError('Unapproved model or additional paid tool')
                    caps=[data[k] for k in ('max_tokens','max_completion_tokens','max_output_tokens') if k in data]
                    if not caps or any(not isinstance(n,int) or n<1 or n>self.config['limits']['maxOutputTokens'] for n in caps):
                        raise PermissionError('Output token limit missing or invalid')
                    reserve=((len(body)+4096)*rates['inputUsdPerMillion']+max(caps)*rates['outputUsdPerMillion'])/1000000
                    if self.model_calls>=self.config['limits']['maxModelCalls'] or self.reserved_usd+reserve>self.config['limits']['maxEstimatedUsd']:
                        raise PermissionError('Model call or estimated budget limit exceeded')
                    self.model_calls+=1
                    self.reserved_usd+=reserve
                elif method.upper() not in ('GET','POST'):
                    raise PermissionError('Data provider method not allowed')
                self.requests+=1
                self.sources.append({'url':u.scheme+'://'+u.hostname+u.path,'requestedAt':datetime.now(timezone.utc).isoformat()})
            except Exception:
                self.blocked+=1
                raise

    def summary(self):
        return {'requests':self.requests,'modelCalls':self.model_calls,'reservedEstimatedUsd':round(self.reserved_usd,6),'blockedRequests':self.blocked,'sources':self.sources,'pricingSource':'user supplied; estimate, not provider invoice or guaranteed billing cap'}

def install_transport_guards(policy):
    import httpx, requests, urllib.request, urllib.error
    from curl_cffi import requests as curl_requests
    old_send=httpx.Client.send
    def send(self,request,*args,**kwargs):
        policy.before(str(request.url),request.method,request.content)
        kwargs['follow_redirects']=False
        response=old_send(self,request,*args,**kwargs)
        if 300<=response.status_code<400: raise PermissionError('Provider redirect blocked')
        return response
    httpx.Client.send=send
    # Graph entry is synchronous. Fail closed if a future upstream version changes that.
    async def async_send(*args,**kwargs): raise PermissionError('Async provider transport not reviewed')
    httpx.AsyncClient.send=async_send
    old_request=requests.Session.request
    def request(self,method,url,*args,**kwargs):
        body=json.dumps(kwargs.get('json')).encode() if kwargs.get('json') is not None else kwargs.get('data') or b''
        if not isinstance(body,(str,bytes)): body=json.dumps(body).encode()
        policy.before(url,method,body);kwargs['allow_redirects']=False;kwargs['timeout']=min(kwargs.get('timeout') or 20,20)
        return old_request(self,method,url,*args,**kwargs)
    requests.Session.request=request
    old_curl=curl_requests.Session.request
    def curl_request(self,method,url,*args,**kwargs):
        body=json.dumps(kwargs.get('json')).encode() if kwargs.get('json') is not None else kwargs.get('data') or b''
        if not isinstance(body,(str,bytes)): body=json.dumps(body).encode()
        policy.before(url,method,body);kwargs['allow_redirects']=False;kwargs['timeout']=20
        return old_curl(self,method,url,*args,**kwargs)
    curl_requests.Session.request=curl_request
    class RedirectDenied(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): raise PermissionError('Provider redirect blocked')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RedirectDenied())
    def urlopen(url,data=None,timeout=20,**kwargs):
        request=url if isinstance(url,urllib.request.Request) else urllib.request.Request(url,data=data)
        policy.before(request.full_url,request.get_method(),request.data or b'')
        return opener.open(request,timeout=min(timeout,20))
    urllib.request.urlopen=urlopen
