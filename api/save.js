const { dataPath, putJsonFile, requireAdmin } = require('./_github');

module.exports = async function handler(req,res){
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed.'});
  try{
    requireAdmin(req);
    const data = req.body?.data;
    const message = String(req.body?.message || 'Update JS Collections');
    if(!data || typeof data !== 'object') return res.status(400).json({error:'Invalid site data.'});
    delete data.theme;
    await putJsonFile(dataPath('data'), data, message.slice(0,200));
    return res.status(200).json({ok:true});
  }catch(err){ return res.status(err.status || 500).json({error:err.message || 'GitHub save failed.'}); }
};
