"""Loads unchanged TradingAgents only after app approval. Not an OS sandbox."""
import sys,os,json,pathlib,contextlib,importlib.util
work=pathlib.Path.cwd().resolve();bundle=pathlib.Path(sys.argv[1]).resolve()
packages=bundle/'packages';source=bundle/'source';runtime=pathlib.Path(sys.base_prefix).resolve()
raw=sys.stdin.buffer.read(32769)
if len(raw)>32768:raise ValueError('Input too large')
payload=json.loads(raw);cfg=payload['configuration']
sys.path[:0]=[str(packages),str(source)]
# -I -S -B prevents user site, .pth execution, and bytecode writes.
os.environ['OPENAI_API_KEY']=cfg['apiKey']
os.environ['LANGCHAIN_TRACING_V2']='false';os.environ['LANGSMITH_TRACING']='false'
policy_path=pathlib.Path(__file__).with_name('trading-analysis-policy.py')
spec=importlib.util.spec_from_file_location('mody_trading_policy',policy_path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
policy=module.RequestPolicy(cfg)
def within(p,root):
    try:return os.path.commonpath([p,str(root)])==str(root)
    except ValueError:return False
def audit(event,args):
    if event.startswith(('subprocess.','os.exec','os.spawn')) or event in ('os.system','os.startfile'):raise PermissionError('Child processes disabled')
    if event=='open' and isinstance(args[0],(str,bytes,os.PathLike)):
        p=os.path.realpath(os.fsdecode(args[0]));mode=args[1] if isinstance(args[1],str) else '';flags=args[2] if len(args)>2 and isinstance(args[2],int) else 0
        write=any(x in mode for x in 'wax+') or flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC)
        if write and not within(p,work):raise PermissionError('Write outside temporary analysis scope')
        if not write and not any(within(p,r) for r in (work,packages,source,runtime)):raise PermissionError('Read outside reviewed analysis scope')
sys.addaudithook(audit)
with contextlib.redirect_stdout(sys.stderr):
    module.install_transport_guards(policy)
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    config={**DEFAULT_CONFIG,'llm_provider':'openai','backend_url':'https://api.openai.com/v1','quick_think_llm':cfg['quick']['model'],'deep_think_llm':cfg['deep']['model'],'quick_think_provider':None,'deep_think_provider':None,'quick_think_backend_url':None,'deep_think_backend_url':None,'max_tokens':cfg['limits']['maxOutputTokens'],'llm_max_retries':0,'max_debate_rounds':1,'max_risk_discuss_rounds':1,'max_tool_rounds':2,'max_recur_limit':100,'checkpoint_enabled':False,'output_language':'Korean','results_dir':str(work/'reports'),'data_cache_dir':str(work/'cache'),'memory_log_path':str(work/'memory.md'),'news_article_limit':10,'global_news_article_limit':5,'tool_vendors':{},'data_vendors':{'core_stock_apis':'yfinance','technical_indicators':'yfinance','fundamental_data':'yfinance','news_data':'yfinance','macro_data':'disabled','prediction_markets':'disabled'}}
    graph=TradingAgentsGraph(selected_analysts=('market','social','news','fundamentals'),debug=False,config=config)
    state,rating=graph.propagate(payload['ticker'],payload['date'],asset_type='stock',portfolio=None)
reports={k:str(state.get(k,''))[:16000] for k in ('market_report','sentiment_report','news_report','fundamentals_report','investment_plan','trader_investment_plan','final_trade_decision')}
for key in ('investment_debate_state','risk_debate_state'):
    item=state.get(key,{})
    if isinstance(item,dict):reports[key]=str(item.get('history',''))[:16000]
result={'rating':rating,'reports':reports,'network':policy.summary(),'scope':'research only; no order execution; no portfolio or account access'}
print(json.dumps(result,ensure_ascii=True))
