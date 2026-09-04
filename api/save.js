async function validSession(token){
 if(!token||!token.includes("."))return false; const [payload,signature]=token.split(".");
 if(!Number.isFinite(Number(payload))||Number(payload)<Date.now())return false;
 const secret=process.env.ADMIN_SESSION_SECRET||process.env.ADMIN_PASSWORD;if(!secret)return false;
 const enc=new TextEncoder(); const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 return crypto.subtle.verify("HMAC",key,Buffer.from(signature,"base64url"),enc.encode(payload));
}
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const auth=req.headers.authorization||""; if(!(await validSession(auth.startsWith("Bearer ")?auth.slice(7):"")))return res.status(401).json({error:"Admin session expired. Log in again."});
 const repo=process.env.GITHUB_REPO,token=process.env.GITHUB_TOKEN,branch=process.env.GITHUB_BRANCH||"main",path=process.env.GITHUB_DATA_PATH||"data/site-data.json";
 if(!repo||!token)return res.status(500).json({error:"GITHUB_REPO or GITHUB_TOKEN is not configured."});
 if(!req.body?.data||typeof req.body.data!=="object")return res.status(400).json({error:"Invalid site data."});
 const parts=repo.split("/");if(parts.length!==2)return res.status(500).json({error:"GITHUB_REPO must be owner/repository."}); const [owner,name]=parts;
 const headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Authorization":`Bearer ${token}`,"Content-Type":"application/json"};
 const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path}`;
 const current=await fetch(`${base}?ref=${encodeURIComponent(branch)}`,{headers}); let sha;
 if(current.ok)sha=(await current.json()).sha; else if(current.status!==404)return res.status(current.status).json({error:"GitHub read failed."});
 const content=Buffer.from(JSON.stringify(req.body.data,null,2),"utf8").toString("base64");
 const update=await fetch(base,{method:"PUT",headers,body:JSON.stringify({message:String(req.body.message||"Update JS Collections site data").slice(0,120),content,branch,...(sha?{sha}:{})})});
 const result=await update.json().catch(()=>({})); if(!update.ok)return res.status(update.status).json({error:result.message||"GitHub write failed."});
 return res.status(200).json({ok:true,commit:result.commit?.html_url||null});
}
