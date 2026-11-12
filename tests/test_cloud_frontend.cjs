'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../public/edge-cloud.js'),'utf8');
const store=new Map(),root={EDGE_RADAR_CLOUD_URL:''};
const context={window:root,URL,Date,Math,Number,Intl,encodeURIComponent,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},console};
vm.runInNewContext(code,context);
test('Cloud reader rejects insecure/malformed API URLs',()=>{
 assert.equal(root.EdgeCloud.urls('http://example.net'),null);
 assert.equal(root.EdgeCloud.urls('https://legit.example/api/secret'),null);
 assert.equal(root.EdgeCloud.urls('https://legit.example'), 'https://legit.example');
});
test('Cloud signal card safely escapes token name and displays missing measurements',()=>{
 const html=root.EdgeCloud.card({mint:'11111111111111111111111111111111',symbol:'<script>',triggered_at:Date.now(),entry_price:.00001,m1_status:'missing',m5_status:'measured',m5_return:-15});
 assert.equal(html.includes('<script>'),false);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Sem amostra'));assert.ok(html.includes('−')||html.includes('-15'));
});
