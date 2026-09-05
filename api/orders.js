const { env, dataPath, getJsonFile, putJsonFile, gh, githubConfig, requireAdmin } = require('./_github');
const crypto = require('crypto');

const STATUSES = [
  'Order received',
  'Pending payment',
  'Payment confirmed',
  'Processing and packaging',
  'Out for delivery',
  'Delivered'
];

function clean(value,max=2000){ return String(value ?? '').trim().slice(0,max); }
function apiPath(path){return String(path).split('/').map(encodeURIComponent).join('/');}
function normalizeCustomer(c){
  return {name:clean(c?.name,160),contact:clean(c?.contact,100),email:clean(c?.email,254).toLowerCase(),address:clean(c?.address,2000)};
}
function sameCustomer(a,b){
  return ['name','contact','email','address'].every(k=>clean(a?.[k], k==='address'?2000:254).toLowerCase()===clean(b?.[k], k==='address'?2000:254).toLowerCase());
}
function normalizeOrder(input){
  const customer=normalizeCustomer(input?.customer||{});
  const items=Array.isArray(input?.items)?input.items.map(x=>({
    id:clean(x.id,120),name:clean(x.name,200),price:clean(x.price,50),usdPrice:clean(x.usdPrice,50),oldPrice:clean(x.oldPrice,50),oldUsdPrice:clean(x.oldUsdPrice,50),qty:Math.max(1,Math.min(999,Number(x.qty)||1))
  })).filter(x=>x.name):[];
  const total=Number(input?.total||0), usdTotal=Number(input?.usdTotal||0);
  if(!customer.name||!customer.contact||!customer.address||!items.length)throw new Error('Please complete the required order fields.');
  return {id:crypto.randomBytes(12).toString('hex').toUpperCase(),createdAt:new Date().toISOString(),orderNumber:null,pin:null,customer,status:'Order received',statusHistory:[{status:'Order received',at:new Date().toISOString()}],comments:[],items,total:Number.isFinite(total)?total:0,usdTotal:Number.isFinite(usdTotal)?usdTotal:0,currency:'PKR'};
}
function nextOrderNumber(orders){let max=0;for(const o of orders){const n=Number.parseInt(String(o?.orderNumber||''),10);if(Number.isFinite(n))max=Math.max(max,n);}return String(max+1).padStart(3,'0');}
async function putOrders(orders,message,expectedSha){const cfg=githubConfig();const path=dataPath('orders');const content=Buffer.from(JSON.stringify(orders,null,2)+'\n','utf8').toString('base64');const payload={message,content,branch:cfg.branch};if(expectedSha)payload.sha=expectedSha;return gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${apiPath(path)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
async function putCustomers(customers,message,expectedSha){const cfg=githubConfig();const path=dataPath('customers');const content=Buffer.from(JSON.stringify(customers,null,2)+'\n','utf8').toString('base64');const payload={message,content,branch:cfg.branch};if(expectedSha)payload.sha=expectedSha;return gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${apiPath(path)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
async function createOrder(order){
 for(let attempt=0;attempt<5;attempt++){
  const [or,cr]=await Promise.all([getJsonFile(dataPath('orders')),getJsonFile(dataPath('customers'))]);
  const orders=Array.isArray(or.data)?or.data:[]; const customers=Array.isArray(cr.data)?cr.data:[];
  const existing=customers.find(c=>sameCustomer(c,order.customer));
  order.orderNumber=nextOrderNumber(orders); order.pin=existing?.pin || String(Math.floor(1000+Math.random()*9000)); order.customerId=existing?.id || crypto.randomBytes(8).toString('hex');
  const nextCustomer=existing?{...existing,name:order.customer.name,contact:order.customer.contact,email:order.customer.email,address:order.customer.address,lastOrderAt:order.createdAt,orderNumbers:[...new Set([...(existing.orderNumbers||[]),order.orderNumber])]}:{id:order.customerId,pin:order.pin,name:order.customer.name,contact:order.customer.contact,email:order.customer.email,address:order.customer.address,createdAt:order.createdAt,lastOrderAt:order.createdAt,orderNumbers:[order.orderNumber]};
  try{
   await putOrders([...orders,order],`New order #${order.orderNumber}`,or.sha);
   const without=customers.filter(c=>c.id!==nextCustomer.id); await putCustomers([...without,nextCustomer],`Customer ${order.customer.name}`,cr.sha);
   return order;
  }catch(err){if(err.status!==409||attempt===4)throw err;}
 }
 throw new Error('Unable to assign an order number. Please try again.');
}
async function writeOrdersForMutation(mutator,message){
 for(let attempt=0;attempt<5;attempt++){
  const current=await getJsonFile(dataPath('orders')); const orders=Array.isArray(current.data)?current.data:[]; const next=mutator(orders); try{return await putOrders(next,message,current.sha);}catch(err){if(err.status!==409||attempt===4)throw err;}
 }
}
async function sendEmail(order){
 const key=env('RESEND_API_KEY'); const from=env('ORDER_FROM_EMAIL','onboarding@resend.dev'); if(!key)throw new Error('Email service is not configured. Add RESEND_API_KEY in Vercel.');
 const c=order.customer; const items=order.items.map((x,i)=>`${i+1}. ${x.name} × ${x.qty} — USD ${x.usdPrice||'-'} · PKR ${Number(x.price||0).toLocaleString()}`).join('\n');
 const text=['Order received','',`Order number: ${order.orderNumber}`,`Tracking PIN: ${order.pin}`,`Customer: ${c.name}`,`Contact: ${c.contact}`,c.email?`Email: ${c.email}`:'Email: Not provided',`Address: ${c.address}`,'','Order details:',items,'',`Total: USD ${Number(order.usdTotal||0).toLocaleString()} · PKR ${Number(order.total||0).toLocaleString()}`].join('\n');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`js-collections-order-${order.id}`},body:JSON.stringify({from,to:['jsofficialcollections@gmail.com'],reply_to:c.email||undefined,subject:`Order received — #${order.orderNumber}`,text})});
 if(!response.ok){const body=await response.text();throw new Error(`Email delivery failed (${response.status}). ${body.slice(0,250)}`);}
}
module.exports=async function handler(req,res){
 if(req.method==='GET'){
  try{
   const orderNumber=clean(req.query?.order||'');const pin=clean(req.query?.pin||'',4);
   if(orderNumber&&pin){const result=await getJsonFile(dataPath('orders'));const orders=Array.isArray(result.data)?result.data:[];const order=orders.find(o=>String(o.orderNumber)===orderNumber&&String(o.pin)===pin);if(!order)return res.status(404).json({error:'Order not found. Check your order number and PIN.'});return res.status(200).json({order:{orderNumber:order.orderNumber,pin:order.pin,status:order.status,createdAt:order.createdAt,items:order.items,total:order.total,usdTotal:order.usdTotal,currency:'PKR',customer:order.customer,statusHistory:order.statusHistory||[],comments:order.comments||[]},statuses:STATUSES});}
   requireAdmin(req);const result=await getJsonFile(dataPath('orders'));const orders=Array.isArray(result.data)?result.data:[];return res.status(200).json({orders:orders.slice().reverse(),statuses:STATUSES});
  }catch(err){return res.status(err.status||500).json({error:err.message||'Unable to load orders.'});}
 }
 if(req.method==='POST'){
  try{const order=normalizeOrder(req.body);await createOrder(order);let emailWarning='';try{await sendEmail(order);}catch(e){emailWarning=e.message||'Order was saved, but the notification email could not be sent.';}return res.status(200).json({ok:true,orderNumber:order.orderNumber,pin:order.pin,emailWarning});}
  catch(err){return res.status(err.status||500).json({error:err.message||'Unable to submit order.'});}
 }
 if(req.method==='PATCH'){
  try{requireAdmin(req);const orderNumber=clean(req.body?.orderNumber||'',3),status=clean(req.body?.status||'');if(!/^\d{3}$/.test(orderNumber)||!STATUSES.includes(status))return res.status(400).json({error:'Invalid order number or status.'});let updated;await writeOrdersForMutation(orders=>{const idx=orders.findIndex(o=>String(o.orderNumber)===orderNumber);if(idx<0){const e=new Error('Order not found.');e.status=404;throw e;}updated={...orders[idx],status,statusHistory:[...(orders[idx].statusHistory||[]),{status,at:new Date().toISOString()}]};const next=[...orders];next[idx]=updated;return next;},`Order #${orderNumber}: ${status}`);return res.status(200).json({ok:true,order:updated});}
  catch(err){return res.status(err.status||500).json({error:err.message||'Unable to update order.'});}
 }
 if(req.method==='DELETE'){
  try{requireAdmin(req);const orderNumber=clean(req.body?.orderNumber||'',3);if(!/^\d{3}$/.test(orderNumber))return res.status(400).json({error:'Invalid order number.'});await writeOrdersForMutation(orders=>orders.filter(o=>String(o.orderNumber)!==orderNumber),`Deleted order #${orderNumber}`);return res.status(200).json({ok:true});}
  catch(err){return res.status(err.status||500).json({error:err.message||'Unable to delete order.'});}
 }
 if(req.method==='PUT'){
  try{requireAdmin(req);const orderNumber=clean(req.body?.orderNumber||'',3),comment=clean(req.body?.comment||'',2000);if(!/^\d{3}$/.test(orderNumber)||!comment)return res.status(400).json({error:'Add a comment before saving.'});let updated;await writeOrdersForMutation(orders=>{const idx=orders.findIndex(o=>String(o.orderNumber)===orderNumber);if(idx<0){const e=new Error('Order not found.');e.status=404;throw e;}updated={...orders[idx],comments:[...(orders[idx].comments||[]),{id:crypto.randomBytes(6).toString('hex'),text:comment,at:new Date().toISOString()}]};const next=[...orders];next[idx]=updated;return next;},`Comment added to order #${orderNumber}`);return res.status(200).json({ok:true,order:updated});}
  catch(err){return res.status(err.status||500).json({error:err.message||'Unable to save comment.'});}
 }
 return res.status(405).json({error:'Method not allowed.'});
};
