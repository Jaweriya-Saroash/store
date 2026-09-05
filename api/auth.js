const { env, createSession } = require('./_github');

module.exports = async function handler(req,res){
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed.'});
  try{
    const password = String(req.body?.password || '');
    if(!env('ADMIN_PASSWORD')) return res.status(500).json({error:'Admin authentication is not configured.'});
    if(password !== env('ADMIN_PASSWORD')) return res.status(401).json({error:'Incorrect password.'});
    return res.status(200).json({session:createSession()});
  }catch(err){ return res.status(500).json({error:err.message || 'Login failed.'}); }
};
