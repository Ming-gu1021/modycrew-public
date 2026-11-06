"""Read a rating from supplied text using the unchanged upstream module only."""
import sys, os, json, importlib.util
module_dir = os.path.realpath(sys.argv[1])
runtime = os.path.realpath(sys.base_prefix)
work = os.path.realpath(os.getcwd())
def within(p, root):
    try:
        return os.path.commonpath([p, root]) == root
    except ValueError:
        return False
def audit(event, args):
    if event.startswith(('socket.', 'subprocess.', 'os.spawn', 'os.exec')) or event in ('os.system', 'os.startfile', 'urllib.Request'):
        raise PermissionError('External operations disabled')
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        p = os.path.realpath(os.fsdecode(args[0]))
        mode = args[1] if isinstance(args[1], str) else ''
        flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
        if any(x in mode for x in 'wax+') or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC) or not any(within(p, r) for r in (module_dir, runtime, work)):
            raise PermissionError('File access outside rating parser scope')
sys.addaudithook(audit)
raw = sys.stdin.buffer.read(524289)
if len(raw) > 524288:
    raise ValueError('Input too large')
text = json.loads(raw)['text']
if not isinstance(text, str) or not text.strip() or len(text.encode('utf-8')) > 65536:
    raise ValueError('Invalid report text')
spec = importlib.util.spec_from_file_location('mody_reviewed_rating', os.path.join(module_dir, 'rating.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rating = module.parse_rating(text)
if rating not in ('Buy', 'Overweight', 'Hold', 'Underweight', 'Sell', 'REVIEW'):
    raise ValueError('Unexpected rating')
print(json.dumps({'rating': rating}))
