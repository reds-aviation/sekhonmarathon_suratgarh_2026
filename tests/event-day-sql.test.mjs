import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const confirmedFeeMigration = () => readFile(
  new URL('../supabase/migrations/202609070006_confirmed_race_fees.sql', import.meta.url),
  'utf8',
);

async function confirmedFeeFixture({registrationOpen=false,races=[
  ['5',60000],['10',70000],['21',80000],
]}={}){
  const db=new PGlite();
  await db.exec(`create table public.event_config(id text primary key,registration_open boolean not null);
    create table public.race_config(event_id text not null,race text not null,fee_paise integer not null);
    insert into public.event_config values('suratgarh-2026',${registrationOpen});`);
  for(const [race,fee] of races) await db.query(
    "insert into public.race_config(event_id,race,fee_paise) values('suratgarh-2026',$1,$2)",
    [race,fee],
  );
  return db;
}

void test('confirmed fee migration fails closed before it can touch price rows',async t=>{
  const migration=await confirmedFeeMigration();
  await t.test('when registration is open',async()=>{
    const db=await confirmedFeeFixture({registrationOpen:true});
    await assert.rejects(()=>db.exec(migration),/registration is open/i);
    await db.exec('rollback');
    assert.deepEqual((await db.query("select race,fee_paise from public.race_config order by race")).rows,[
      {race:'10',fee_paise:70000},{race:'21',fee_paise:80000},{race:'5',fee_paise:60000},
    ]);
    await db.close();
  });
  await t.test('when the Suratgarh categories are incomplete',async()=>{
    const db=await confirmedFeeFixture({races:[['5',60000],['10',70000]]});
    await assert.rejects(()=>db.exec(migration),/exactly the 5, 10 and 21 km categories/i);
    await db.exec('rollback');
    assert.deepEqual((await db.query("select race,fee_paise from public.race_config order by race")).rows,[
      {race:'10',fee_paise:70000},{race:'5',fee_paise:60000},
    ]);
    await db.close();
  });
});

void test('event-day PostgreSQL permissions, timing authority and certificate lifecycle',async t=>{
  const db=new PGlite();
  const user='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', official='00000000-0000-4000-8000-000000000003', historic='00000000-0000-4000-8000-000000000004';
  const q=(sql,args=[])=>db.query(sql,args);
  const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
  const as=async(role,id,fn)=>{await db.exec(`set role ${role}`);await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub','',false)");}};
  const rpc=(id,action,payload={})=>as('authenticated',id,()=>scalar('select public.event_day($1,$2)',[action,JSON.stringify(payload)]));
  const rejects=(fn,fragment)=>assert.rejects(fn,error=>!fragment||error.message.includes(fragment));
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:cardinality(string_to_array(name,'/'))-1]$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;`);
  for(const id of [user,other,official,historic]) await q("insert into auth.users values($1,$2,now(),false)",[id,`${id}@example.test`]);
  for(const file of ['202609050001_marathon.sql','202609050002_organizer_setup.sql','202609050003_contacts.sql','202609050004_event_day.sql','202609050005_certificates.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  await t.test('pre-correction setup stays closed with the previous race prices',async()=>{
    assert.equal(await scalar('select registration_open or payment_configured from public.event_config'),false);
    assert.deepEqual((await q('select fee_paise from public.race_config order by fee_paise')).rows.map(r=>r.fee_paise),[60000,70000,80000]);
    assert.equal(await scalar('select timing_enabled or self_submission_open from marathon_private.event_day_settings'),false);
    assert.equal(await scalar('select enabled from marathon_private.certificate_settings'),false);
  });
  await q("update public.event_config set event_starts_at=now()+interval '2 days',registration_deadline=now()+interval '1 day',registration_open=true,payment_configured=true,payment_qr_url='https://example.test/qr.png',payee_name='Test organiser',upi_id='test@example'");
  const historicInvitation=await scalar("insert into marathon_private.invitations(event_id,label,code_sha256,expires_at) values('suratgarh-2026','Historical test',repeat('b',64),now()+interval '1 day') returning id");
  await q("insert into marathon_private.memberships(event_id,user_id,invitation_id) values('suratgarh-2026',$1,$2)",[historic,historicInvitation]);
  const historicSubmission='10000000-0000-4000-8000-000000000000',historicPath=`${historic}/${historicSubmission}/receipt.png`;
  await q("insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",[historicPath]);
  const historicRegistration=await scalar(`insert into public.registrations(user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,consent,fee_paise)
    values($1,$2,'Historical fee snapshot','9123456789','placeholder@example.test','1990-01-01','male','5','M','O+','9234567890','Suratgarh','airwarrior','HIST-12345',$3,true,1) returning id`,[historic,historicSubmission,historicPath]);
  const historicFee=await scalar('select fee_paise from public.registrations where id=$1',[historicRegistration]);
  assert.equal(historicFee,60000);
  await q("update public.event_config set registration_open=false where id='suratgarh-2026'");
  await db.exec(await confirmedFeeMigration());
  await t.test('confirmed fee migration updates the current price list but preserves registration snapshots',async()=>{
    assert.deepEqual((await q('select race,fee_paise from public.race_config where event_id=$1 order by race',['suratgarh-2026'])).rows,[
      {race:'10',fee_paise:49900},{race:'21',fee_paise:49900},{race:'5',fee_paise:39900},
    ]);
    assert.equal(await scalar('select fee_paise from public.registrations where id=$1',[historicRegistration]),historicFee);
  });
  await q("insert into marathon_private.organizers(event_id,user_id) values('suratgarh-2026',$1)",[official]);
  await q("update public.event_config set event_starts_at=now()+interval '2 days',registration_deadline=now()+interval '1 day',registration_open=true,payment_configured=true,payment_qr_url='https://example.test/qr.png',payee_name='Test organiser',upi_id='test@example'");
  const invitation=await scalar("insert into marathon_private.invitations(event_id,label,code_sha256,expires_at) values('suratgarh-2026','Test',repeat('a',64),now()+interval '1 day') returning id");
  for(const id of [user,other]) await q("insert into marathon_private.memberships(event_id,user_id,invitation_id) values('suratgarh-2026',$1,$2)",[id,invitation]);
  async function registration(id,race,n){
    const sub=`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,path=`${id}/${sub}/receipt.png`;
    await q("insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",[path]);
    return scalar(`insert into public.registrations(user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,consent,fee_paise)
      values($1,$2,$3,'9123456789','placeholder@example.test','1990-01-01','male',$4,'M','O+','9234567890','Suratgarh','airwarrior',$5,$6,true,1) returning id`,[id,sub,`Synthetic test runner ${n}`,race,`TEST-${n}-12345`,path]);
  }
  const reg=await registration(user,'5',1), regOther=await registration(other,'5',2), reg10=await registration(user,'10',3);
  await t.test('participants cannot mutate private data or run organiser operations',async()=>{
    await as('authenticated',user,()=>rejects(()=>q('select * from marathon_private.race_results'),'permission denied'));
    await rejects(()=>rpc(user,'start_clock',{race:'5',request_id:crypto.randomUUID()}),'organiser');
    await rejects(()=>rpc(user,'review_payment',{registration_id:reg,status:'verified'}),'organiser');
    await as('anon',null,()=>rejects(()=>q("select public.event_day('snapshot')"),'permission denied'));
    await as('authenticated',user,()=>rejects(()=>q('select public.prepare_certificate_backend($1,$2,$3)',[user,reg,'completion']),'permission denied'));
  });
  await t.test('payment approval creates a unique human ID and owner snapshots exclude other people',async()=>{
    assert.equal((await rpc(user,'snapshot')).registrations.find(r=>r.id===reg).registration_number,null);
    for(const id of [reg,regOther,reg10]) await rpc(official,'review_payment',{registration_id:id,status:'verified'});
    const mine=await rpc(user,'snapshot');
    assert.equal(mine.registrations.length,2);
    assert.ok(mine.registrations.every(r=>/^SEKO26-\d{5,}$/.test(r.registration_number)));
    assert.equal(new Set(mine.registrations.map(r=>r.registration_number)).size,2);
    assert.ok(mine.registrations.every(r=>r.receipt_path===null));
    await rejects(()=>rpc(official,'review_payment',{registration_id:reg,status:'rejected',note:'Wrong reference'}),'already reviewed');
  });
  const startKey=crypto.randomUUID();
  await t.test('category clocks fail closed, start idempotently and cannot be reset',async()=>{
    await rejects(()=>rpc(official,'start_clock',{race:'5',request_id:startKey}),'not been enabled');
    await q('update marathon_private.event_day_settings set timing_enabled=true,self_submission_open=true');
    const first=await rpc(official,'start_clock',{race:'5',request_id:startKey});
    assert.equal((await rpc(official,'start_clock',{race:'5',request_id:startKey})).started_at,first.started_at);
    await rejects(()=>rpc(official,'start_clock',{race:'5',request_id:crypto.randomUUID()}),'already started');
    await rejects(()=>rpc(official,'capture_finish',{race:'10',request_id:crypto.randomUUID()}),'Start this category');
  });
  // A deterministic one-hour fixture, not a public API clock-reset capability.
  await q("update marathon_private.race_clocks set started_at=now()-interval '1 hour'");
  await t.test('self-time checks ownership, clock, sensible limits and duplicates',async()=>{
    await rejects(()=>rpc(other,'self_time',{registration_id:reg,elapsed_seconds:1000}),'owned');
    await rejects(()=>rpc(user,'self_time',{registration_id:reg10,elapsed_seconds:1000}),'not started');
    for(const seconds of [0,1,90000,5000]) await rejects(()=>rpc(user,'self_time',{registration_id:reg,elapsed_seconds:seconds}),'accepted range');
    const first=await rpc(user,'self_time',{registration_id:reg,elapsed_seconds:1500});
    assert.equal(first.provenance,'participant_submitted');
    assert.equal((await rpc(user,'self_time',{registration_id:reg,elapsed_seconds:1500})).revision,1);
    await rejects(()=>rpc(user,'self_time',{registration_id:reg,elapsed_seconds:1600}),'already submitted');
    assert.equal((await rpc(user,'snapshot')).registrations.find(r=>r.id===reg).result.prize_eligible,false);
  });
  let certificate;
  const prepare=()=>as('service_role',null,()=>scalar('select public.prepare_certificate_backend($1,$2,$3)',[user,reg,'completion']));
  await t.test('certificates need approved private assets and valid results; no frontend signature read',async()=>{
    await rejects(prepare,'not been configured');
    await q("update marathon_private.certificate_settings set enabled=true,signer_name='Synthetic authorised signatory',signer_designation='Test designation',signature_object_path='test/signature-v1.png',font_object_path='test/font.ttf',approval_reference='TEST-ONLY',approved_at=now(),verification_base_url='https://example.test/event/'");
    certificate=(await prepare()).certificate;
    assert.equal(certificate.status,'pending');
    assert.equal(certificate.snapshot.timing_provenance,'participant_submitted');
    assert.equal((await prepare()).certificate.id,certificate.id);
    const path=`${reg}/${certificate.id}.pdf`;
    await q("insert into storage.objects(bucket_id,name,metadata) values('event-certificates',$1,'{\"mimetype\":\"application/pdf\",\"size\":1000}')",[path]);
    await as('service_role',null,()=>scalar('select public.complete_certificate_backend($1,$2)',[certificate.id,'a'.repeat(64)]));
    await as('authenticated',user,async()=>assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id in ('certificate-signatures','event-certificates')"),0));
    const verified=await as('anon',null,()=>scalar('select public.verify_certificate($1)',[certificate.verification_token]));
    assert.equal(verified.status,'valid');
    assert.equal(verified.signature_type,'approved visual facsimile');
    assert.equal(verified.email,undefined);assert.equal(verified.mobile,undefined);assert.equal(verified.signer_name,undefined);
  });
  const markKey=crypto.randomUUID();
  await t.test('signer approvals are versioned and cannot mix old names with new signature files',async()=>{
    const prepareParticipation=()=>as('service_role',null,()=>scalar('select public.prepare_certificate_backend($1,$2,$3)',[user,reg,'participation']));
    const first=await prepareParticipation();
    await q("update marathon_private.certificate_settings set signer_name='Another synthetic signatory',signature_object_path='test/signature-v2.png'");
    await as('service_role',null,()=>rejects(()=>scalar('select public.complete_certificate_backend($1,$2)',[first.certificate.id,'b'.repeat(64)]),'approval changed'));
    const next=await prepareParticipation();
    assert.notEqual(next.certificate.id,first.certificate.id);
    assert.equal(next.certificate.snapshot.signer_name,'Another synthetic signatory');
    assert.equal(next.signature_object_path,'test/signature-v2.png');
    assert.equal(first.signature_object_path,'test/signature-v1.png');
    assert.ok(next.certificate.approval_revision>first.certificate.approval_revision);
    await rejects(()=>q('update marathon_private.certificate_settings set verification_base_url=null'),'check constraint');
    await rejects(()=>q("update marathon_private.certificate_settings set verification_base_url='https://'"),'check constraint');
  });
  await t.test('participant correction retains an explicit certificate hold',async()=>{
    const current=(await rpc(user,'snapshot')).registrations.find(entry=>entry.id===reg).result;
    await rpc(official,'review_result',{registration_id:reg,status:'correction_required',expected_revision:current.revision,note:'Confirm this reading against the finish list.',certificate_hold:true});
    const corrected=await rpc(user,'self_time',{registration_id:reg,elapsed_seconds:1500});
    assert.equal(corrected.certificate_hold,true);
    await rejects(prepare,'organiser release');
  });
  await t.test('timestamp-first finish marks are idempotent and same-category association wins over self-time',async()=>{
    const first=await rpc(official,'capture_finish',{race:'5',request_id:markKey,device_captured_at:new Date().toISOString()});
    assert.equal(first.registration_id,null);
    assert.equal((await rpc(official,'capture_finish',{race:'5',request_id:markKey})).captured_at,first.captured_at);
    await rejects(()=>rpc(official,'associate_finish',{finish_id:markKey,registration_id:reg10}),'same category');
    const assigned=await rpc(official,'associate_finish',{finish_id:markKey,registration_id:reg});
    assert.equal(assigned.provenance,'organiser_recorded');
    assert.equal(assigned.certificate_hold,true);
    assert.equal((await rpc(official,'associate_finish',{finish_id:markKey,registration_id:reg})).revision,assigned.revision);
    await rejects(()=>rpc(official,'associate_finish',{finish_id:markKey,registration_id:regOther}),'already assigned');
    await rejects(()=>rpc(user,'self_time',{registration_id:reg,elapsed_seconds:1700}),'official or locked');
    assert.equal((await as('anon',null,()=>scalar('select public.verify_certificate($1)',[certificate.verification_token]))).status,'revoked');
  });
  await t.test('stale organiser reviews cannot overwrite newer changes; omitted hold means preserve',async()=>{
    const current=(await rpc(user,'snapshot')).registrations.find(entry=>entry.id===reg).result;
    await rejects(()=>rpc(official,'review_result',{registration_id:reg,status:'verified',note:'Stale operator screen.',expected_revision:current.revision-1}),'changed since');
    const verified=await rpc(official,'review_result',{registration_id:reg,status:'verified',note:'Checked official finish list.',expected_revision:current.revision});
    assert.equal(verified.certificate_hold,true);
    await rejects(()=>rpc(official,'review_result',{registration_id:reg,status:'verified',note:'Conflicting second operator.',expected_revision:current.revision}),'changed since');
    const released=await rpc(official,'review_result',{registration_id:reg,status:'verified',note:'Organiser explicitly released the certificate hold.',expected_revision:verified.revision,certificate_hold:false});
    assert.equal(released.certificate_hold,false);
  });
  await t.test('review records provenance/evidence; lock blocks all participant and organiser changes',async()=>{
    await rejects(()=>rpc(official,'review_result',{registration_id:reg,status:'verified',note:''}),'evidence');
    const current=(await rpc(user,'snapshot')).registrations.find(entry=>entry.id===reg).result;
    const locked=await rpc(official,'review_result',{registration_id:reg,status:'locked',note:'Finish console and manual list compared.',expected_revision:current.revision});
    assert.equal(locked.provenance,'organiser_recorded');
    assert.equal((await rpc(user,'snapshot')).registrations.find(r=>r.id===reg).result.prize_eligible,true);
    await rejects(()=>rpc(official,'review_result',{registration_id:reg,status:'verified',note:'Attempt to change locked record'}),'Locked');
    await rejects(()=>rpc(user,'self_time',{registration_id:reg,elapsed_seconds:2000}),'official or locked');
    await q("update public.event_config set registration_open=false,registration_deadline=now()-interval '1 hour'");
    assert.equal((await rpc(user,'snapshot')).registrations.length,2);
    assert.ok(await scalar('select count(*)>0 from marathon_private.event_audit'));
  });
  await db.close();
});
