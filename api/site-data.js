export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  try{
    const repoRaw=process.env.GITHUB_REPO||"";
    const branch=process.env.GITHUB_BRANCH||"main";
    const path=process.env.GITHUB_DATA_PATH||"data/site-data.json";
    const ghToken=process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";

    if(!repoRaw) return res.status(500).json({error:"GITHUB_REPO is missing in Vercel."});

    const repo=repoRaw.replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/^\/+/,"").replace(/\/+$/,"");
    if(repo.split("/").length!==2) return res.status(500).json({error:"GITHUB_REPO must be owner/repository."});

    const headers={
      "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28"
    };
    if(ghToken) headers.Authorization=`Bearer ${ghToken}`;

    const r=await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,{headers});
    const payload=await r.json().catch(()=>({}));

    if(!r.ok){
      return res.status(r.status).json({error:`GitHub load failed: ${payload.message||"unknown GitHub error"}`});
    }

    return res.status(200).json({
      data:JSON.parse(Buffer.from(payload.content||"","base64").toString("utf8"))
    });
  }catch(err){
    console.error("SITE DATA ERROR",err);
    return res.status(500).json({error:`Could not load site data: ${err.message||"unknown error"}`});
  }
}
