export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const password=String(req.body?.password||""); const expected=process.env.ADMIN_PASSWORD;
 if(!expected)return res.status(500).json({error:"ADMIN_PASSWORD is not configured in Vercel."});
 if(password!==expected)return res.status(401).json({error:"Incorrect admin password."});
 const secret=process.env.ADMIN_SESSION_SECRET||expected; const payload=String(Date.now()+12*60*60*1000);
 const enc=new TextEncoder(); const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,enc.encode(payload));
 return res.status(200).json({session:`${payload}.${Buffer.from(sig).toString("base64url")}`});
}
