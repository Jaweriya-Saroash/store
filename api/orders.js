const { env, dataPath, getJsonFile, putJsonFile, gh, githubConfig } = require('./_github');
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
function adminSecret(){ return env('ADMIN_SESSION_SECRET', env('ADMIN_PASSWORD','')); }
function sign(value){ return crypto.createHmac('sha256', adminSecret()).update(value).digest('hex'); }
function validSession(token){
  if(!token || !adminSecret()) return false;
  const [ts, sig] = String(token).split('.');
  const time = Number(ts);
  if(!ts || !sig || !Number.isFinite(time) || Date.now()-time>1000*60*60*12 || time>Date.now()+60000) return false;
  const expected=sign(ts), a=Buffer.from(sig), b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function assertAdmin(req){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!validSession(token)){const e=new Error('Unauthorized.');e.status=401;throw e;}
}
function apiPath(path){return String(path).split('/').map(encodeURIComponent).join('/');}

function normalizeOrder(input){
  const customer=input?.customer||{};
  const items=Array.isArray(input?.items)?input.items.map(x=>({
    id:clean(x.id,120),name:clean(x.name,200),price:clean(x.price,50),oldPrice:clean(x.oldPrice,50),qty:Math.max(1,Math.min(999,Number(x.qty)||1))
  })).filter(x=>x.name):[];
  const total=Number(input?.total||0);
  if(!clean(customer.name,160)||!clean(customer.contact,100)||!clean(customer.address,2000)||!items.length) throw new Error('Please complete the required order fields.');
  return {
    id:crypto.randomBytes(12).toString('hex').toUpperCase(),
    createdAt:new Date().toISOString(),
    orderNumber:null,
    pin:String(Math.floor(1000+Math.random()*9000)),
    status:'Order received',
    statusHistory:[{status:'Order received',at:new Date().toISOString()}],
    customer:{name:clean(customer.name,160),contact:clean(customer.contact,100),email:clean(customer.email,254),address:clean(customer.address,2000)},
    items,total:Number.isFinite(total)?total:0,currency:clean(input?.currency,20)||'PKR'
  };
}

function nextOrderNumber(orders){
  let max=0;
  for(const o of orders){const n=Number.parseInt(String(o?.orderNumber||''),10);if(Number.isFinite(n))max=Math.max(max,n);}
  return String(max+1).padStart(3,'0');
}

async function putOrdersAtomically(orders,message,expectedSha){
  const cfg=githubConfig();
  const path=dataPath('orders');
  const content=Buffer.from(JSON.stringify(orders,null,2)+'\n','utf8').toString('base64');
  const payload={message,content,branch:cfg.branch};
  if(expectedSha)payload.sha=expectedSha;
  return gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${apiPath(path)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
}

async function createOrderWithSerial(order){
  for(let attempt=0;attempt<5;attempt++){
    const current=await getJsonFile(dataPath('orders'));
    const orders=Array.isArray(current.data)?current.data:[];
    order.orderNumber=nextOrderNumber(orders);
    try{
      await putOrdersAtomically([...orders,order],`New order #${order.orderNumber}`,current.sha);
      return order;
    }catch(err){
      if(err.status!==409 || attempt===4) throw err;
    }
  }
  throw new Error('Unable to assign an order number. Please try again.');
}

async function saveOrders(updatedOrders,currentSha,message,orderNumber,status){
  let candidate=updatedOrders;
  for(let attempt=0;attempt<4;attempt++){
    try{return await putOrdersAtomically(candidate,message,currentSha);}catch(err){
      if(err.status!==409 || attempt===3)throw err;
      const fresh=await getJsonFile(dataPath('orders'));
      const latest=Array.isArray(fresh.data)?fresh.data:[];
      const idx=latest.findIndex(o=>String(o.orderNumber)===String(orderNumber));
      if(idx<0){const e=new Error('Order no longer exists.');e.status=404;throw e;}
      latest[idx].status=status;
      latest[idx].statusHistory=Array.isArray(latest[idx].statusHistory)?latest[idx].statusHistory:[];
      latest[idx].statusHistory.push({status,at:new Date().toISOString()});
      candidate=latest;currentSha=fresh.sha;
    }
  }
}

async function sendEmail(order){
  const key=env('RESEND_API_KEY');
  const from=env('ORDER_FROM_EMAIL','onboarding@resend.dev');
  if(!key)throw new Error('Email service is not configured. Add RESEND_API_KEY in Vercel.');
  const c=order.customer;
  const items=order.items.map((x,i)=>`${i+1}. ${x.name} × ${x.qty} — ${order.currency} ${Number(x.price||0).toLocaleString()}`).join('\n');
  const text=[
    'Order received','',`Order number: ${order.orderNumber}`,`Tracking PIN: ${order.pin}`,`Customer: ${c.name}`,`Contact: ${c.contact}`,
    c.email?`Email: ${c.email}`:'Email: Not provided',`Address: ${c.address}`,'','Order details:',items,'',`Total: ${order.currency} ${Number(order.total||0).toLocaleString()}`
  ].join('\n');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`js-collections-order-${order.id}`},body:JSON.stringify({from,to:['jsofficialcollections@gmail.com'],reply_to:c.email||undefined,subject:`Order received — #${order.orderNumber}`,text})});
  if(!response.ok){const body=await response.text();throw new Error(`Email delivery failed (${response.status}). ${body.slice(0,250)}`);}
}

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    try{
      const orderNumber=clean(req.query?.order||'');
      const pin=clean(req.query?.pin||'',4);
      if(orderNumber && pin){
        const current=await getJsonFile(dataPath('orders')); const orders=Array.isArray(current.data)?current.data:[];
        const order=orders.find(o=>String(o.orderNumber)===orderNumber && String(o.pin)===pin);
        if(!order)return res.status(404).json({error:'Order not found. Check your order number and PIN.'});
        return res.status(200).json({order:{orderNumber:order.orderNumber,status:order.status,createdAt:order.createdAt,items:order.items,total:order.total,currency:order.currency,customer:{name:order.customer.name,contact:order.customer.contact},statusHistory:order.statusHistory||[]}});
      }
      assertAdmin(req);
      const result=await getJsonFile(dataPath('orders')); const orders=Array.isArray(result.data)?result.data:[];
      return res.status(200).json({orders:orders.slice().reverse(),statuses:STATUSES});
    }catch(err){return res.status(err.status||500).json({error:err.message||'Unable to load orders.'});}
  }
  if(req.method==='PATCH'){
    try{
      assertAdmin(req);
      const orderNumber=clean(req.body?.orderNumber||'',3), status=clean(req.body?.status||'');
      if(!/^\d{3}$/.test(orderNumber)||!STATUSES.includes(status))return res.status(400).json({error:'Invalid order number or status.'});
      const current=await getJsonFile(dataPath('orders')); const orders=Array.isArray(current.data)?current.data:[];
      const idx=orders.findIndex(o=>String(o.orderNumber)===orderNumber);
      if(idx<0)return res.status(404).json({error:'Order not found.'});
      orders[idx].status=status;
      orders[idx].statusHistory=Array.isArray(orders[idx].statusHistory)?orders[idx].statusHistory:[];
      orders[idx].statusHistory.push({status,at:new Date().toISOString()});
      await saveOrders(orders,current.sha,`Order #${orderNumber}: ${status}`,orderNumber,status);
      return res.status(200).json({ok:true,order:orders[idx]});
    }catch(err){return res.status(err.status||500).json({error:err.message||'Unable to update order.'});}
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  try{
    const order=normalizeOrder(req.body);
    await createOrderWithSerial(order);
    let emailWarning='';
    try{await sendEmail(order);}catch(emailErr){emailWarning=emailErr.message||'Order was saved, but the notification email could not be sent.';}
    return res.status(200).json({ok:true,orderNumber:order.orderNumber,pin:order.pin,emailWarning});
  }catch(err){return res.status(err.status||500).json({error:err.message||'Unable to submit order.'});}
};
