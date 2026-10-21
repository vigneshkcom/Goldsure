// Actual product PDFs are supplied by the user and committed as static assets.
// Append versions; keep old registry entries/files for historic quote resends.
import manifest from '../Battery/quotes/documents.json' with {type:'json'};
import {BatteryQuoteError} from './battery-quote-model.js';
export function bundledDocuments(){return manifest.map(item=>{
 if(!/^\/assets\/battery-quote-documents\/[A-Za-z0-9_.-]+\.pdf$/.test(item.path)||!['battery','inverter','general'].includes(item.kind)||!Array.isArray(item.package_ids))throw new BatteryQuoteError('The bundled product document registry needs review.',503);
 return {...item,object_path:'repo:'+item.path};
});}
export function attachBundledDocuments(packages){const docs=bundledDocuments();return packages.map(pkg=>({...pkg,document_ids:[...new Set([...pkg.document_ids,...docs.filter(d=>d.package_ids.includes(pkg.id)).map(d=>d.id)])]}));}
export async function bundledDocumentBytes(document,env=process.env,fetchImpl=fetch){
 const known=bundledDocuments().find(d=>d.id===document.id&&d.object_path===document.object_path&&d.sha256===document.sha256);
 if(!known)throw new BatteryQuoteError('The saved product attachment is no longer in the registry. Restore its original file before resending.',409);
 const base=(env.SITE_URL||'https://portal.goldsure.com.au').replace(/\/$/,'');const r=await fetchImpl(base+known.path,{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new BatteryQuoteError('A bundled product PDF could not be downloaded. Sending stopped.',502);
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>3*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new BatteryQuoteError('A bundled attachment is not a valid PDF. Sending stopped.',409);
 return bytes;
}
