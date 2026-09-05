const { env, dataPath, getJsonFile, putJsonFile, requireAdmin } = require('./_github');

function clean(value,max=2000){ return String(value ?? '').trim().slice(0,max); }
function makeId(){
  const d=new Date();
  const base=d.toISOString().replace(/\D/g,'').slice(0,14);
  return `${base}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}
function normalizeOrder(input){
  const customer=input?.customer||{};
  const items=Array.isArray(input?.items)?input.items.map(x=>({
    id:clean(x.id,120),name:clean(x.name,200),price:clean(x.price,50),oldPrice:clean(x.oldPrice,50),qty:Math.max(1,Math.min(999,Number(x.qty)||1))
  })).filter(x=>x.name):[];
  const total=Number(input?.total||0);
  if(!clean(customer.name,160)||!clean(customer.contact,100)||!clean(customer.address,2000)||!items.length) throw new Error('Please complete the required order fields.');
  return {
    id:makeId(), createdAt:new Date().toISOString(),
    customer:{name:clean(customer.name,160),contact:clean(customer.contact,100),email:clean(customer.email,254),address:clean(customer.address,2000)},
    items, total:Number.isFinite(total)?total:0, currency:clean(input?.currency,20)||'PKR'
  };
}
async function sendEmail(order){
  const key=env('RESEND_API_KEY');
  const from=env('ORDER_FROM_EMAIL');
  if(!key || !from) throw new Error('Email service is not configured. Add RESEND_API_KEY and ORDER_FROM_EMAIL in Vercel.');
  const customer=order.customer;
  const items=order.items.map((x,i)=>`${i+1}. ${x.name} × ${x.qty} — ${order.currency} ${Number(x.price||0).toLocaleString()}`).join('\n');
  const text=[
    'Order received',
    '',
    `Order ID: ${order.id}`,
    `Customer: ${customer.name}`,
    `Contact: ${customer.contact}`,
    customer.email ? `Email: ${customer.email}` : 'Email: Not provided',
    `Address: ${customer.address}`,
    '', 'Order details:', items,
    '', `Total: ${order.currency} ${Number(order.total||0).toLocaleString()}`
  ].join('\n');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`js-collections-order-${order.id}`},body:JSON.stringify({from,to:['jsofficialcollections@gmail.com'],reply_to:customer.email||undefined,subject:`Order received — ${order.id}`,text})});
  if(!response.ok){const body=await response.text();throw new Error(`Email delivery failed (${response.status}). ${body.slice(0,180)}`);}
}

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    try{requireAdmin(req); const result=await getJsonFile(dataPath('orders')); const orders=Array.isArray(result.data)?result.data:[]; return res.status(200).json({orders:orders.slice().reverse()});}
    catch(err){return res.status(err.status||500).json({error:err.message||'Unable to load orders.'});}
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  try{
    const order=normalizeOrder(req.body);
    const current=await getJsonFile(dataPath('orders'));
    const orders=Array.isArray(current.data)?current.data:[];
    orders.push(order);
    await putJsonFile(dataPath('orders'),orders,`New order ${order.id}`);
    await sendEmail(order);
    return res.status(200).json({ok:true,orderId:order.id});
  }catch(err){
    return res.status(err.status||500).json({error:err.message||'Unable to submit order.'});
  }
};
