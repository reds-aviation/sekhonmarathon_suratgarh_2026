// A participant may correct a rejected payment only by supplying a fresh proof.
// The database RPC owns the state transition; this function validates the
// caller and exact image bytes, stores a new private object without upsert,
// then invokes the authenticated owner-only correction transaction.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import {
  EVENT_ID,
  MAX_RECEIPT_BYTES,
  receiptDigestSha256,
  receiptExtension,
  validatePaymentCorrectionPayload,
} from '../submit-registration/validation.ts';

function configuredSiteOrigin(value:string|undefined) {
  if(!value)throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');
  let parsed:URL;
  try{parsed=new URL(value);}catch{throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path.');
  }
  return parsed.origin;
}

const allowedOrigin=configuredSiteOrigin(Deno.env.get('SITE_ORIGIN'));
const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const bucket='payment-receipts';
const cors={
  'Access-Control-Allow-Origin':allowedOrigin,
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Vary':'Origin',
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'},
});

function correctionError(message:string, code:string|undefined) {
  if(code==='42501')return {message:'You must be signed in with the invited account that submitted this entry.',status:403};
  if(code==='23505')return {message:'This correction request or payment reference was already used. Please check your entry before trying again.',status:409};
  if(code==='55000')return {message:'This entry is not currently eligible for a payment correction.',status:409};
  if(code==='22023')return {message:'Please check the correction details and payment screenshot.',status:400};
  if(message.includes('verified email')||message.includes('station invitation')||message.includes('only your own')) {
    return {message:'You must be signed in with the invited account that submitted this entry.',status:403};
  }
  if(message.includes('Only a rejected payment')||message.includes('current payment evidence')||message.includes('already has current')) {
    return {message:'This entry is not currently eligible for a payment correction.',status:409};
  }
  return {message:'Your correction could not be recorded. Please retry without making another payment.',status:503};
}

Deno.serve(async(req:Request)=>{
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==allowedOrigin)return json({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);

  const token=req.headers.get('Authorization');
  if(!token?.startsWith('Bearer '))return json({error:'Please sign in to correct a payment.'},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token.slice(7));
  if(authError||!user?.id||!user.email_confirmed_at||user.is_anonymous) {
    return json({error:'Please verify your email and sign in again.'},401);
  }
  const {data:membership,error:memberError}=await userClient.rpc('get_my_membership',{p_event_id:EVENT_ID});
  if(memberError||!membership?.is_member)return json({error:'Verify your station invitation code before correcting a payment.'},403);

  try{
    if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data')) {
      return json({error:'Invalid correction format.'},400);
    }
    const maxBody=MAX_RECEIPT_BYTES+65536;
    const declaredLength=req.headers.get('Content-Length');
    if(declaredLength&&(!/^\d+$/.test(declaredLength)||Number(declaredLength)>maxBody)) {
      return json({error:'Screenshot exceeds the 5 MB limit.'},413);
    }
    const reader=req.body?.getReader();
    if(!reader)return json({error:'No correction data received.'},400);
    const chunks:Uint8Array[]=[];
    let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>maxBody){await reader.cancel();return json({error:'Screenshot exceeds the 5 MB limit.'},413);}
      chunks.push(value);
    }
    const rawBody=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){rawBody.set(chunk,offset);offset+=chunk.length;}
    const form=await new Response(rawBody,{headers:{'Content-Type':req.headers.get('Content-Type')!}}).formData();
    const rawPayload=form.get('payload');
    if(typeof rawPayload!=='string'||rawPayload.length>4096)return json({error:'Invalid correction details.'},400);
    const parsed=JSON.parse(rawPayload);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return json({error:'Invalid correction details.'},400);
    const data=validatePaymentCorrectionPayload(parsed as Record<string,unknown>);
    const receipt=form.get('receipt');
    if(!(receipt instanceof File))return json({error:'Please attach your replacement payment screenshot.'},400);
    const bytes=new Uint8Array(await receipt.arrayBuffer());
    const ext=receiptExtension(bytes,receipt.type);
    const receiptDigest=await receiptDigestSha256(bytes);
    // The correction ID gives retries one safe canonical object but makes every
    // new correction distinct. No prior receipt can be overwritten.
    const receiptPath=`${user.id}/payment-corrections/${data.registration_id}/${data.correction_id}/receipt.${ext}`;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error:uploadError}=await admin.storage.from(bucket).upload(receiptPath,bytes,{
      contentType:receipt.type,
      upsert:false,
      cacheControl:'0',
    });
    if(uploadError){
      // A network loss after upload is safe to retry only with the exact same
      // bytes. A different image under the same correction ID is never reused.
      const {data:saved,error:savedError}=await admin.storage.from(bucket).download(receiptPath);
      if(savedError||!saved)return json({error:'Your screenshot could not be saved. Please retry shortly without making another payment.'},503);
      const savedDigest=await receiptDigestSha256(new Uint8Array(await saved.arrayBuffer()));
      if(savedDigest!==receiptDigest)return json({error:'This correction already has a different screenshot. Start a new correction if you need to replace it.'},409);
    }

    const {data:outcome,error:rpcError}=await userClient.rpc('submit_payment_correction',{
      p_event_id:EVENT_ID,
      p_registration_id:data.registration_id,
      p_transaction_utr:data.transaction_id,
      p_receipt_path:receiptPath,
      p_receipt_digest_sha256:receiptDigest,
      p_request_id:data.correction_id,
    });
    if(rpcError){
      const mapped=correctionError(rpcError.message,rpcError.code);
      return json({error:mapped.message},mapped.status);
    }
    if(!outcome||typeof outcome!=='object')return json({error:'Your correction could not be recorded. Please retry without making another payment.'},503);
    const result=outcome as Record<string,unknown>;
    return json({
      registration_id:result.registration_id,
      payment_attempt_id:result.payment_attempt_id,
      payment_status:result.status,
      source_revision:result.source_revision,
    },201);
  }catch(error){
    const message=error instanceof Error?error.message:'Invalid correction.';
    const expected=['Enter ','Please ','Your screenshot','Upload ','Invalid ','This event','The emergency'];
    return json({error:expected.some(prefix=>message.startsWith(prefix))?message:'We could not process this correction. Please retry without making another payment.'},400);
  }
});
