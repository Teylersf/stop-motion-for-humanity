"use strict";
// GPL-3.0-or-later. Collect exact local production dependency license texts.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'assets','licenses','npm');
fs.mkdirSync(destination,{recursive:true});
const visited=new Set(),records=[];
function locate(name,parent){let current=parent;while(true){const candidate=path.join(current,'node_modules',name,'package.json');if(fs.existsSync(candidate))return candidate;const next=path.dirname(current);if(next===current)throw new Error('Missing production dependency: '+name);current=next;}}
function collect(name,parent){const metaPath=locate(name,parent),folder=path.dirname(metaPath),meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));const key=meta.name+'@'+meta.version;if(visited.has(key))return;visited.add(key);const files=[];for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(!entry.isFile()||! /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(entry.name))continue;const bytes=fs.readFileSync(path.join(folder,entry.name));const filename=meta.name.replaceAll('/','__')+'-'+meta.version+'-'+entry.name;fs.writeFileSync(path.join(destination,filename),bytes);files.push({file:filename,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}if(!files.length)throw new Error('No license text found for '+key);records.push({name:meta.name,version:meta.version,license:meta.license||null,files});for(const dependency of Object.keys(meta.dependencies||{}))collect(dependency,folder);}
const application=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const name of Object.keys(application.dependencies||{}))collect(name,root);
records.sort((a,b)=>a.name.localeCompare(b.name));
fs.writeFileSync(path.join(destination,'MANIFEST.json'),JSON.stringify({schema_version:1,application:application.name,dependencies:records},null,2)+'\n');
console.log(JSON.stringify({dependencies:records.length,licenseFiles:records.reduce((sum,item)=>sum+item.files.length,0)}));
