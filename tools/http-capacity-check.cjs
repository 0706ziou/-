// A bounded read-only check of the owner's web entry. This does not measure game capacity.
const http=require('node:http');
const https=require('node:https');
const {performance}=require('node:perf_hooks');
async function run(){
  const target=new URL(process.argv[2]||'');
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('Supply an HTTP(S) URL without credentials.');
  const stages=[],seconds=5,levels=[2,8,20];
  const agent=new (target.protocol==='http:'?http:https).Agent({keepAlive:true,maxSockets:4});
  try{
    for(const rate of levels){
      const latencies=[],errors={},tasks=[],started=performance.now();let ok=0,skipped=0,inflight=0;
      const probe=()=>new Promise(resolve=>{
        const at=performance.now();inflight++;
        const req=(target.protocol==='http:'?http:https).request(target,{method:'HEAD',agent,timeout:2500,headers:{'User-Agent':'OrchardCapacityCheck/1.0'}},res=>{
          res.resume();res.on('end',()=>{if(res.statusCode>=200&&res.statusCode<400)ok++;else errors['HTTP_'+res.statusCode]=(errors['HTTP_'+res.statusCode]||0)+1;done()});res.on('error',fail);
        });
        let finished=false;
        function done(){if(finished)return;finished=true;latencies.push(performance.now()-at);inflight--;resolve()}
        function fail(error){if(finished)return;errors[error.code||'REQUEST_ERROR']=(errors[error.code||'REQUEST_ERROR']||0)+1;done()}
        req.on('timeout',()=>req.destroy(Object.assign(new Error('timeout'),{code:'REQUEST_TIMEOUT'})));req.on('error',fail);req.end();
      });
      const timer=setInterval(()=>{if(inflight>=4)skipped++;else tasks.push(probe())},1000/rate);
      await new Promise(resolve=>setTimeout(resolve,seconds*1000));clearInterval(timer);await Promise.all(tasks);
      const duration=(performance.now()-started)/1000,sorted=latencies.sort((a,b)=>a-b),failed=Object.values(errors).reduce((a,b)=>a+b,0);
      const percentile=p=>sorted.length?+sorted[Math.max(0,Math.ceil(sorted.length*p)-1)].toFixed(1):null;
      stages.push({targetRps:rate,requests:tasks.length,successful:ok,failed,skipped,actualRps:+(tasks.length/duration).toFixed(2),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),errors});
      if(failed>0||skipped>0||percentile(.95)>500)break;
    }
  }finally{agent.destroy()}
  console.log(JSON.stringify({target:target.origin+target.pathname,method:'HEAD',scope:'web entry only; no gameplay, database, payload bandwidth or simultaneous-player capacity measured',maximumRequestsPerSecond:20,maximumConcurrentRequests:4,stages},null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1});
