export const EVENT_ID = 'suratgarh-2026';
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const fields = ['full_name','mobile','dob','gender','race','tshirt','blood_group','emergency_contact','city','participant_type','transaction_id'] as const;
export function validatePayload(raw: Record<string,unknown>, today=new Date(Date.now()+19800000).toISOString().slice(0,10)) {
 if(raw.event_id!==EVENT_ID) throw new Error('This event is not available.');
 if(typeof raw.submission_id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.submission_id)) throw new Error('Invalid submission reference. Please reopen registration.');
 if(raw.consent!==true) throw new Error('Please accept the registration terms.');
 const clean = Object.fromEntries(fields.map(k=>[k,typeof raw[k]==='string'?(raw[k] as string).trim():''])) as Record<typeof fields[number],string>;
 if(clean.full_name.length<2||clean.full_name.length>120)throw new Error('Enter the participant’s full name.');
 if(!/^[6-9][0-9]{9}$/.test(clean.mobile)||!/^[6-9][0-9]{9}$/.test(clean.emergency_contact))throw new Error('Enter valid 10-digit Indian mobile numbers.');
 if(clean.mobile===clean.emergency_contact)throw new Error('The emergency contact must be another person.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(clean.dob)||!Number.isFinite(Date.parse(clean.dob))||new Date(clean.dob).toISOString().slice(0,10)!==clean.dob||clean.dob<'1920-01-01'||clean.dob>today)throw new Error('Enter a valid date of birth.');
 const choices:Record<string,string[]>={gender:['male','female','other','prefer_not_to_say'],race:['5','10','21'],tshirt:['XS','S','M','L','XL','XXL','XXXL'],blood_group:['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'],participant_type:['airwarrior','family']};
 for(const [key,values] of Object.entries(choices))if(!values.includes(clean[key as keyof typeof clean]))throw new Error(`Please select a valid ${key.replaceAll('_',' ')}.`);
 if(clean.city.length<2||clean.city.length>100)throw new Error('Enter a valid city.');
 if(!/^[A-Za-z0-9-]{6,64}$/.test(clean.transaction_id))throw new Error('Enter a valid transaction reference.');
 return {...clean,transaction_id:clean.transaction_id.toLowerCase(),event_id:EVENT_ID,submission_id:raw.submission_id.toLowerCase(),consent:true};
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validatePaymentCorrectionPayload(raw: Record<string,unknown>) {
 const registrationId=typeof raw.registration_id==='string'?raw.registration_id.trim():'';
 const correctionId=typeof raw.correction_id==='string'?raw.correction_id.trim():'';
 const transactionId=typeof raw.transaction_id==='string'?raw.transaction_id.trim():'';
 if(raw.event_id!==EVENT_ID)throw new Error('This event is not available.');
 if(!UUID.test(registrationId))throw new Error('Invalid registration reference.');
 if(!UUID.test(correctionId))throw new Error('Invalid correction reference. Please try again.');
 if(!/^[A-Za-z0-9-]{6,64}$/.test(transactionId))throw new Error('Enter a valid transaction reference.');
 return {
  event_id:EVENT_ID,
  registration_id:registrationId.toLowerCase(),
  correction_id:correctionId.toLowerCase(),
  transaction_id:transactionId.toLowerCase(),
 };
}
export function receiptExtension(bytes:Uint8Array,mime:string) {
 if(bytes.length===0||bytes.length>MAX_RECEIPT_BYTES)throw new Error('Your screenshot must be no larger than 5 MB.');
 if(mime==='image/jpeg'&&bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(mime==='image/png'&&bytes.length>24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'png';
 throw new Error('Upload a valid JPG or PNG payment screenshot.');
}
export async function receiptDigestSha256(bytes:Uint8Array) {
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
}
