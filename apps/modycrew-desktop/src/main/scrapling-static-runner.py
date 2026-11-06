"""Application-owned static parser adapter; input is JSON data, never Python code."""
import sys, json, os

packages = os.path.realpath(sys.argv[1])
work = os.path.realpath(os.getcwd())
runtime = os.path.realpath(sys.base_prefix)
def within(p, root):
    try:
        return os.path.commonpath([p, root]) == root
    except ValueError:
        return False

def audit(event, args):
    if event.startswith(('socket.', 'subprocess.', 'os.spawn', 'os.exec')) or event in ('os.system', 'os.startfile', 'urllib.Request'):
        raise PermissionError('Network and child processes are disabled')
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        p = os.path.realpath(os.fsdecode(args[0]))
        mode = args[1] if isinstance(args[1], str) else ''
        flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
        writing = any(x in mode for x in 'wax+') or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)
        if writing or not any(within(p, root) for root in (packages, runtime, work)):
            raise PermissionError('File access outside the static parser scope')

sys.addaudithook(audit)
raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
if len(raw) > 8 * 1024 * 1024:
    raise ValueError('Input too large')
payload = json.loads(raw)
html, selector = payload['html'], payload['selector']
if not isinstance(html, str) or not isinstance(selector, str) or not 1 <= len(selector) <= 512 or len(html.encode('utf-8')) > 1048576:
    raise ValueError('Invalid static HTML request')
sys.path.insert(0, packages)
from scrapling.parser import Selector
from lxml.html import HTMLParser, fromstring

root = fromstring(html, parser=HTMLParser(no_network=True, huge_tree=False))
page = Selector(root=root, adaptive=False)
matches = page.css(selector).getall()
values = []
size = 0
for item in matches[:100]:
    value = str(item)[:2000]
    size += len(json.dumps(value, ensure_ascii=True))
    if size > 200000:
        break
    values.append(value)
print(json.dumps({'matches': values, 'limit': 100, 'staticOnly': True, 'truncated': len(values) < len(matches) or any(len(str(x)) > 2000 for x in matches[:100])}, ensure_ascii=True))
