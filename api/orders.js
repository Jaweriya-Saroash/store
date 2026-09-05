const { env, dataPath, getJsonFile, putJsonFile } = require('./_github');
const crypto = require('crypto');

function clean(value,max=2000){ return String(value ?? '').trim().slice(0,max); }

function adminSecret(){ return env('ADMIN_SESSION_SECRET', env('ADMIN_PASSWORD','')); }
function sign(value){ return crypto.createHmac('sha256', adminSecret()).update(value).digest('hex'); }
function validSession(token){
  if(!token || !adminSecret()) return false;
  const [ts, sig] = String(token).split('.');
  if(!ts || !sig) return false;
  const time = Number(ts);
  if(!Number.isFinite(time) || Date.now() - time > 1000*60*60*12 || time > Date.now()+60000) return false;
  const expected = sign(ts);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function assertAdmin(req){
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if(!validSession(token)){ const e = new Error('Unauthorized.'); e.status = 401; throw e; }
}

function makeId(){
  const d=new Date();
  const base=d.toISOString().replace(/\D/g,'').slice(0,14);
  return `${base}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
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
  const from=env('ORDER_FROM_EMAIL','onboarding@resend.dev');
  if(!key) throw new Error('Email service is not configured. Add RESEND_API_KEY in Vercel.');
  const customer=order.customer;
  const items=order.items.map((x,i)=>`${i+1}. ${x.name} × ${x.qty} — ${order.currency} ${Number(x.price||0).toLocaleString()}`).join('\n');
  const text=[
    'Order received','',`Order ID: ${order.id}`,`Customer: ${customer.name}`,`Contact: ${customer.contact}`,
    customer.email ? `Email: ${customer.email}` : 'Email: Not provided',`Address: ${customer.address}`,
    '','Order details:',items,'',`Total: ${order.currency} ${Number(order.total||0).toLocaleString()}`
  ].join('\n');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`js-collections-order-${order.id}`},
    body:JSON.stringify({from,to:['jsofficialcollections@gmail.com'],reply_to:customer.email||undefined,subject:`Order received — ${order.id}`,text})
  });
  if(!response.ok){const body=await response.text();throw new Error(`Email delivery failed (${response.status}). ${body.slice(0,250)}`);}
}

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    try{
      assertAdmin(req);
      const result=await getJsonFile(dataPath('orders'));
      const orders=Array.isArray(result.data)?result.data:[];
      return res.status(200).json({orders:orders.slice().reverse()});
    }catch(err){
      return res.status(err.status||500).json({error:err.message||'Unable to load orders.'});
    }
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});

  try{
    const order=normalizeOrder(req.body);
    const current=await getJsonFile(dataPath('orders'));
    const orders=Array.isArray(current.data)?current.data:[];
    orders.push(order);
    await putJsonFile(dataPath('orders'),orders,`New order ${order.id}`);

    let emailWarning='';
    try{
      await sendEmail(order);
    }catch(emailErr){
      emailWarning=emailErr.message || 'Order was saved, but the notification email could not be sent.';
    }

    return res.status(200).json({ok:true,orderId:order.id,emailWarning});
  }catch(err){
    return res.status(err.status||500).json({error:err.message||'Unable to submit order.'});
  }
};
