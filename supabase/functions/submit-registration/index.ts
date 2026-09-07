import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { EVENT_ID, MAX_RECEIPT_BYTES, validatePayload, receiptDigestSha256, receiptExtension } from './validation.ts';

function configuredSiteOrigin(value:string|undefined) {
 if(!value)throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');
 let parsed:URL;
 try{parsed=new URL(value);}catch{throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('SITE_ORIGIN must be an HTTPS origin without a path.');
 return parsed.origin;
}
const allowedOrigin = configuredSiteOrigin(Deno.env.get('SITE_ORIGIN'));
const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const bucket='payment-receipts';
const cors={'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});

Deno.serve(async(req:Request)=>{
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==allowedOrigin)return json({error:'Origin not allowed.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed.'},405);
 // Gateway verification is disabled for compatibility with new Supabase signing
 // keys. Every request is authenticated here with Auth getUser before any access.
 const token=req.headers.get('Authorization');
 if(!token?.startsWith('Bearer '))return json({error:'Please sign in to register.'},401);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await userClient.auth.getUser(token.slice(7));
 if(authError||!user?.id||!user.email_confirmed_at||user.is_anonymous)return json({error:'Please verify your email and sign in again.'},401);
 const {data:membership,error:memberError}=await userClient.rpc('get_my_membership',{p_event_id:EVENT_ID});
 if(memberError||!membership?.is_member)return json({error:'Verify your station invitation code before registering.'},403);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  if(!req.headers.get('Content-Type')?.startsWith('multipart/form-data'))return json({error:'Invalid submission format.'},400);
  const maxBody=MAX_RECEIPT_BYTES+65536;
  if(Number(req.headers.get('Content-Length'))>maxBody)return json({error:'Screenshot exceeds the 5 MB limit.'},413);
  const reader=req.body?.getReader();if(!reader)return json({error:'No registration data received.'},400);
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBody){await reader.cancel();return json({error:'Screenshot exceeds the 5 MB limit.'},413);}chunks.push(value);}
  const rawBody=new Uint8Array(size);let offset=0;for(const chunk of chunks){rawBody.set(chunk,offset);offset+=chunk.length;}
  const form=await new Response(rawBody,{headers:{'Content-Type':req.headers.get('Content-Type')!}}).formData();
  const rawPayload=form.get('payload');if(typeof rawPayload!=='string'||rawPayload.length>16384)return json({error:'Invalid participant details.'},400);
  const parsed=JSON.parse(rawPayload);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return json({error:'Invalid participant details.'},400);
  const data=validatePayload(parsed);
  const existing=await admin.from('registrations').select('*').eq('user_id',user.id).eq('submission_id',data.submission_id).maybeSingle();
  if(existing.error)return json({error:'Registration is temporarily unavailable. Please retry without making another payment.'},503);
  if(existing.data){if(Object.entries(data).some(([k,v])=>existing.data[k]!==v))return json({error:'This entry reference was already submitted with different details. Contact the organising team.'},409);return json({registration_id:existing.data.id,payment_status:existing.data.payment_status});}
  const {data:config,error:configError}=await admin.from('event_config').select('*').eq('id',EVENT_ID).single();
  if(configError||!config.registration_open||!config.payment_configured||Date.now()>Date.parse(config.registration_deadline))return json({error:'Registration is not currently open.'},409);
  const {data:race,error:raceError}=await admin.from('race_config').select('fee_paise').eq('event_id',EVENT_ID).eq('race',data.race).single();
  if(raceError)return json({error:'That race category is unavailable.'},400);
  const receipt=form.get('receipt');if(!(receipt instanceof File))return json({error:'Please attach your payment screenshot.'},400);
  const bytes=new Uint8Array(await receipt.arrayBuffer());const ext=receiptExtension(bytes,receipt.type);
  const receiptDigest=await receiptDigestSha256(bytes);
  const receiptPath=`${user.id}/${data.submission_id}/receipt.${ext}`;
  const {error:uploadError}=await admin.storage.from(bucket).upload(receiptPath,bytes,{contentType:receipt.type,upsert:false,cacheControl:'0'});
  if(uploadError){
   // A previous request may have stored the file and stopped before inserting.
   // Reuse only identical bytes at the same authenticated canonical path.
   const {data:saved,error:savedError}=await admin.storage.from(bucket).download(receiptPath);
   if(savedError||!saved)return json({error:'Your screenshot could not be saved. Please retry shortly without making another payment.'},503);
   if(receiptDigest!==await receiptDigestSha256(new Uint8Array(await saved.arrayBuffer())))return json({error:'This entry already has a different screenshot. Reopen registration to start a new entry.'},409);
  }
  const {data:row,error:insertError}=await admin.from('registrations').insert({...data,user_id:user.id,email:user.email,fee_paise:race.fee_paise,receipt_path:receiptPath,receipt_digest_sha256:receiptDigest,payment_status:'pending_review'}).select('id,payment_status').single();
  if(insertError){
   // If the insert response was uncertain, confirm it before removing the file.
   const {data:confirmed}=await admin.from('registrations').select('*').eq('user_id',user.id).eq('submission_id',data.submission_id).maybeSingle();
   if(confirmed){if(Object.entries(data).some(([k,v])=>confirmed[k]!==v))return json({error:'This entry reference was already submitted with different details. Contact the organising team.'},409);return json({registration_id:confirmed.id,payment_status:confirmed.payment_status});}
   // Never delete here: another in-flight insert may still reference this path.
   // Orphans are private and can be reviewed by the owner after the event.
   return json({error:insertError.code==='23505'?'This transaction reference has already been submitted. Contact the organising team if you need help.':'Your entry could not be saved. Retry without making another payment.'},insertError.code==='23505'?409:503);
  }
  return json({registration_id:row.id,payment_status:row.payment_status},201);
 }catch(e){
  const message=e instanceof Error?e.message:'Invalid submission.';
  const expected=['Enter ','Please ','Your screenshot','Upload ','Invalid ','This event','The emergency'];
  return json({error:expected.some(p=>message.startsWith(p))?message:'We could not process this entry. Please retry without making another payment.'},400);
 }
});
