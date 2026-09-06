const { getJsonFile, dataPath } = require('./_github');

module.exports = async function handler(req,res){
  if(req.method !== 'GET') return res.status(405).json({error:'Method not allowed.'});
  try{
    const result = await getJsonFile(dataPath('data'));
    return res.status(200).json({data: result.data || null});
  }catch(err){ return res.status(500).json({error:err.message || 'Unable to load site data.'}); }
};
