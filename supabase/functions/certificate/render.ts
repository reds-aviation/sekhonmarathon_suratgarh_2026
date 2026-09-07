import { PDFDocument, rgb } from 'pdf-lib';
// @deno-types="./regenerator-runtime.d.ts"
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
// @deno-types="npm:@types/qrcode@1.5.6"
import QRCode from 'qrcode';

export type CertificateSnapshot = { participant_name:string;registration_number:string;race:string;event_date:string;elapsed_seconds:number;timing_provenance:string;signer_name:string;signer_designation:string;event_title:string;organiser:string };
export async function renderCertificate(input:{number:string;kind:'completion'|'participation';verificationUrl:string;snapshot:CertificateSnapshot;signature:Uint8Array;fontBytes:Uint8Array;fallbackFontBytes?:Uint8Array}):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(input.fontBytes,{subset:true});
  const fallback=input.fallbackFontBytes?await pdf.embedFont(input.fallbackFontBytes,{subset:true}):null;
  const fonts=[font,...(fallback?[fallback]:[])],characterSets=fonts.map(item=>new Set(item.getCharacterSet()));
  const snapshot=input.snapshot;
  const strings=[...Object.values(snapshot).filter(value=>typeof value==='string'),input.number,'CERTIFICATE OF COMPLETION PARTICIPATION Land of Sun and Sand Approved visual signature; verification confirms the issued record. Self-reported completion time Finish-console time Organiser-verified time Organiser-corrected time'];
  for(const value of strings)for(const char of String(value))if(!characterSets.some(set=>set.has(char.codePointAt(0)!)))throw new Error('The approved font does not support all certificate characters.');
  const runs=(text:string)=>{const result:{text:string;index:number}[]=[];for(const {segment} of new Intl.Segmenter('en',{granularity:'grapheme'}).segment(text)){const index=characterSets.findIndex(set=>[...segment].every(char=>set.has(char.codePointAt(0)!)));if(index<0)throw new Error('The approved font does not support all certificate characters.');const last=result[result.length-1];if(last?.index===index)last.text+=segment;else result.push({text:segment,index});}return result;};
  const width=(text:string,size:number)=>runs(text).reduce((sum,run)=>sum+fonts[run.index].widthOfTextAtSize(run.text,size),0);
  const page=pdf.addPage([842,595]),navy=rgb(.063,.184,.231),teal=rgb(.157,.439,.4),sand=rgb(.965,.953,.918),muted=rgb(.34,.40,.42);
  page.drawRectangle({x:0,y:0,width:842,height:595,color:sand});
  page.drawRectangle({x:28,y:28,width:786,height:539,borderWidth:1,borderColor:teal});
  page.drawRectangle({x:28,y:552,width:786,height:15,color:navy});
  const draw=(text:string,x:number,y:number,size:number,color=navy)=>{for(const run of runs(text)){page.drawText(run.text,{x,y,size,font:fonts[run.index],color});x+=fonts[run.index].widthOfTextAtSize(run.text,size);}};
  const centre=(text:string,y:number,size=14,color=navy)=>draw(text,(842-width(text,size))/2,y,size,color);
  const wrap=(text:string,maxWidth:number,size:number)=>{
    const words=text.split(/\s+/),lines:string[]=[];let current='';
    for(const word of words){
      const next=current?`${current} ${word}`:word;
      if(width(next,size)<=maxWidth){current=next;continue;}
      if(current){lines.push(current);current='';}
      for(const {segment} of new Intl.Segmenter('en',{granularity:'grapheme'}).segment(word)){
        if(current&&width(current+segment,size)>maxWidth){lines.push(current);current='';}
        current+=segment;
        if(width(current,size)>maxWidth)throw new Error('Certificate text does not fit the approved layout.');
      }
    }
    if(current)lines.push(current);return lines;
  };
  const fitSingle=(text:string,maxWidth:number,preferred:number,min:number)=>{let size=preferred;while(width(text,size)>maxWidth&&size>min)size--;if(width(text,size)>maxWidth)throw new Error('Certificate text does not fit the approved layout.');return size;};
  centre(snapshot.event_title,510,fitSingle(snapshot.event_title,700,22,14));centre(snapshot.organiser,485,fitSingle(snapshot.organiser,700,12,9),muted);
  centre(`CERTIFICATE OF ${input.kind.toUpperCase()}`,432,27,teal);
  centre(input.kind==='completion'?'This certifies that':'Presented to',390,13,muted);
  let nameSize=30;while(width(snapshot.participant_name,nameSize)>700&&nameSize>22)nameSize--;
  let nameLines=wrap(snapshot.participant_name,700,nameSize);
  while(nameLines.length>3&&nameSize>18){nameSize--;nameLines=wrap(snapshot.participant_name,700,nameSize);}
  if(nameLines.length>3)throw new Error('Participant name does not fit the approved certificate layout.');
  nameLines.forEach((line,i)=>centre(line,350-i*33,nameSize));
  const afterName=350-(nameLines.length-1)*33;
  centre(`completed the ${snapshot.race} KM event on ${snapshot.event_date}`,afterName-42,15);
  const total=Math.floor(snapshot.elapsed_seconds),time=[Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(value=>String(value).padStart(2,'0')).join(':');
  const provenance:Record<string,string>={participant_submitted:'Self-reported completion time',organiser_recorded:'Finish-console time',organiser_verified:'Organiser-verified time',organiser_corrected:'Organiser-corrected time'};
  centre(`${provenance[snapshot.timing_provenance]||'Completion time'}: ${time}`,afterName-70,13,muted);
  centre(`Registration ${snapshot.registration_number}  |  Certificate ${input.number}`,afterName-95,10,muted);
  const signature=await pdf.embedPng(input.signature),scale=Math.min(155/signature.width,58/signature.height);
  page.drawImage(signature,{x:130+(155-signature.width*scale)/2,y:120,width:signature.width*scale,height:signature.height*scale});
  page.drawLine({start:{x:102,y:111},end:{x:340,y:111},thickness:.5,color:teal});
  const signerLines=wrap(`${snapshot.signer_name} · ${snapshot.signer_designation}`,240,10);
  if(signerLines.length>3)throw new Error('Signatory details do not fit the approved certificate layout.');
  for(const [index,line] of signerLines.entries())draw(line,102,96-index*14,10,navy);
  const qr=QRCode.create(input.verificationUrl,{errorCorrectionLevel:'M'}),moduleSize=90/(qr.modules.size+8),originX=630,originY=98;
  page.drawRectangle({x:originX,y:originY,width:90,height:90,color:rgb(1,1,1)});
  for(let row=0;row<qr.modules.size;row++)for(let col=0;col<qr.modules.size;col++)if(qr.modules.get(row,col))page.drawRectangle({x:originX+(col+4)*moduleSize,y:originY+(qr.modules.size-row+3)*moduleSize,width:moduleSize,height:moduleSize,color:rgb(0,0,0)});
  page.drawText('Scan to verify',{x:641,y:84,size:9,font,color:navy});
  centre('Approved visual signature; verification confirms the issued record.',49,9,muted);
  pdf.setTitle(`${input.number} - ${input.kind} certificate`);pdf.setAuthor(snapshot.organiser);pdf.setSubject('Event certificate with approved signature facsimile. Not a cryptographically digitally signed PDF.');
  return pdf.save();
}
