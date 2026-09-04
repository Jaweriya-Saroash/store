export default async function handler(req,res){
 const repo=process.env.GITHUB_REPO,branch=process.env.GITHUB_BRANCH||"main",path=process.env.GITHUB_DATA_PATH||"data/site-data.json";
 if(!repo)return res.status(500).json({error:"GITHUB_REPO is not configured."});
 const headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}; if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
 const r=await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,{headers});
 if(!r.ok)return res.status(r.status).json({error:"Could not load site data from GitHub."}); const payload=await r.json();
 try{return res.status(200).json({data:JSON.parse(Buffer.from(payload.content,"base64").toString("utf8"))});}
 catch{return res.status(500).json({error:"site-data.json is invalid JSON."});}
}
