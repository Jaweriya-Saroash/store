async function validSession(token){
  if(!token || !token.includes(".")) return false;
  const [payload,signature]=token.split(".");
  if(!Number.isFinite(Number(payload)) || Number(payload)<Date.now()) return false;
  const secret=process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if(!secret) return false;
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  return crypto.subtle.verify("HMAC",key,Buffer.from(signature,"base64url"),enc.encode(payload));
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});

  try{
    const auth=req.headers.authorization||"";
    const session=auth.startsWith("Bearer ")?auth.slice(7):"";
    if(!(await validSession(session))) return res.status(401).json({error:"Admin session expired. Log in again."});

    const repoRaw=process.env.GITHUB_REPO||"";
    const ghToken=process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
    const branch=process.env.GITHUB_BRANCH||"main";
    const path=process.env.GITHUB_DATA_PATH||"data/site-data.json";

    if(!repoRaw) return res.status(500).json({error:"GITHUB_REPO is missing in Vercel."});
    if(!ghToken) return res.status(500).json({error:"GITHUB_TOKEN (or GITHUB_PAT) is missing in Vercel."});

    const repo=repoRaw.replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/^\/+/,"").replace(/\/+$/,"");
    const parts=repo.split("/");
    if(parts.length!==2) return res.status(500).json({error:"GITHUB_REPO must be owner/repository (for example: yourname/js-collections)."});

    const [owner,name]=parts;
    const body=req.body||{};
    if(!body.data || typeof body.data!=="object") return res.status(400).json({error:"Invalid site data."});

    const headers={
      "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      "Authorization":`Bearer ${ghToken}`,
      "Content-Type":"application/json"
    };

    const apiRoot=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path}`;
    const current=await fetch(`${apiRoot}?ref=${encodeURIComponent(branch)}`,{headers});
    let sha;

    if(current.ok){
      const currentJson=await current.json();
      sha=currentJson.sha;
    }else if(current.status!==404){
      const detail=await current.json().catch(()=>({}));
      return res.status(current.status).json({error:`GitHub read failed: ${detail.message||"unknown error"}`});
    }

    const content=Buffer.from(JSON.stringify(body.data,null,2),"utf8").toString("base64");
    const update=await fetch(apiRoot,{
      method:"PUT",
      headers,
      body:JSON.stringify({
        message:String(body.message||"Update JS Collections site data").slice(0,120),
        content,
        branch,
        ...(sha?{sha}:{})
      })
    });

    const result=await update.json().catch(()=>({}));
    if(!update.ok){
      return res.status(update.status).json({
        error:`GitHub save failed: ${result.message||"unknown GitHub error"}`
      });
    }

    return res.status(200).json({ok:true,commit:result.commit?.html_url||null});
  }catch(err){
    console.error("SAVE ERROR",err);
    return res.status(500).json({error:`Save function error: ${err.message||"unknown error"}`});
  }
}
