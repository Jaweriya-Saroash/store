const { dataPath, getJsonFile, putJsonFile, requireAdmin, githubConfig, gh } = require('./_github');
function pathEncode(p){return String(p).split('/').map(encodeURIComponent).join('/');}
async function writeCustomers(customers,sha,message){const cfg=githubConfig();const path=dataPath('customers');const content=Buffer.from(JSON.stringify(customers,null,2)+'\n','utf8').toString('base64');const payload={message,content,branch:cfg.branch};if(sha)payload.sha=sha;return gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${pathEncode(path)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
module.exports=async function(req,res){
 try{
  requireAdmin(req);
  if(req.method==='GET'){const r=await getJsonFile(dataPath('customers'));return res.status(200).json({customers:Array.isArray(r.data)?r.data.sort((a,b)=>String(b.lastOrderAt||'').localeCompare(String(a.lastOrderAt||''))):[]});}
  if(req.method==='DELETE'){const id=String(req.body?.id||'');if(!id)return res.status(400).json({error:'Customer id is required.'});for(let i=0;i<5;i++){const r=await getJsonFile(dataPath('customers'));const list=Array.isArray(r.data)?r.data:[];const next=list.filter(c=>String(c.id)!==id);if(next.length===list.length)return res.status(404).json({error:'Customer not found.'});try{await writeCustomers(next,r.sha,'Deleted customer');return res.status(200).json({ok:true});}catch(e){if(e.status!==409||i===4)throw e;}}}
  return res.status(405).json({error:'Method not allowed.'});
 }catch(err){return res.status(err.status||500).json({error:err.message||'Unable to load customers.'});}
};
