import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,imports={}){const module={exports:{}};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;new Function('require','module','exports',code)(n=>{if(n in imports)return imports[n];if(n==='next/server')return require(n);throw Error('Unmocked dependency: '+n)},module,module.exports);return module.exports;}
const projection=load('src/lib/aliexpress-official-preview.ts');
const aliases=load('src/lib/aliexpress-catalog-id.ts');
const source='3256807751901453';
const fixture={result:{ae_item_base_info_dto:{product_id:source,subject:'Fixture',detail:'<p>Dress</p>',session:'SECRET'},ae_multimedia_info_dto:{image_urls:'https://example.com/front.jpg;javascript:secret',ae_video_dtos:[{media_url:'https://example.com/video.mp4',session:'SECRET'}]},ae_item_sku_info_dtos:[{sku_id:'1200001',sku_attr:'14:29#15;5:872',sku_price:'10.00',sku_available_stock:3,session:'SECRET',ae_sku_property_dtos:[{sku_property_id:14,property_value_id:29,sku_property_name:'Color',sku_property_value:'WHITE',property_value_definition_name:'15',sku_image:'https://example.com/native.jpg',session:'SECRET'}]}]}};
const p=projection.projectOfficialPreview(fixture,[source]);assert.equal(p.skus[0].properties[0].property_value_definition_name,'15');assert.equal(p.skus[0].properties[0].property_value_id,29);assert.equal(p.skus[0].sku_attr,'14:29#15;5:872');assert.equal(p.videos.length,1);assert.equal(p.images.length,1);assert.ok(!JSON.stringify(p).includes('SECRET'));
const wrapped=structuredClone(fixture);wrapped.result.ae_multimedia_info_dto.ae_video_dtos={ae_video_d_t_o:fixture.result.ae_multimedia_info_dto.ae_video_dtos};wrapped.result.ae_item_sku_info_dtos={ae_item_sku_info_d_t_o:fixture.result.ae_item_sku_info_dtos};assert.deepEqual(projection.projectOfficialPreview(wrapped,[source]),p);assert.throws(()=>projection.projectOfficialPreview(fixture,['1005000000000']),/identidade/);
let reads=0,sessions=0,requests=0;const state={supplier:{sourceProductId:source,provider:'ALIEXPRESS',status:'ACTIVE'},envelope:fixture,error:false};
const noOtherOperation=new Proxy({}, {get(_t,k){if(k==='findFirst')return async args=>{reads++;assert.deepEqual(args.where,{id:'supplier',productId:'product'});return state.supplier};throw Error('Forbidden database operation: '+String(k));}});
const prisma=new Proxy({}, {get(_t,k){if(k==='supplierProduct')return noOtherOperation;throw Error('Forbidden database access: '+String(k));}});
const route=load('src/app/api/products/[id]/suppliers/[supplierId]/official-preview/route.ts',{'@/lib/prisma':{prisma},'@/lib/aliexpress-connection':{requireAliExpressSession:async options=>{sessions++;assert.deepEqual(options,{readOnly:true});return {session:'SECRET',client:{getDropshipProduct:async input=>{requests++;assert.deepEqual(input,{session:'SECRET',productId:source,shipToCountry:'US',targetCurrency:'USD',targetLanguage:'EN'});if(state.error)throw Error('SECRET upstream credentials');return state.envelope;}}}}},'@/lib/aliexpress-catalog-id':aliases,'@/lib/aliexpress-official-preview':projection});
async function get(){return route.GET(new Request('https://manager.example/api/preview'),{params:Promise.resolve({id:'product',supplierId:'supplier'})});}
let response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');let body=await response.json();assert.equal(body.persisted,false);assert.equal(body.readOnly,true);assert.equal(body.product.skus[0].properties[0].property_value_definition_name,'15');assert.ok(!JSON.stringify(body).includes('SECRET'));
state.error=true;response=await get();assert.equal(response.status,502);assert.ok(!(await response.text()).includes('SECRET'));state.error=false;
state.envelope={result:{ae_item_base_info_dto:{product_id:'1005000000000'}}};response=await get();assert.equal(response.status,502);
state.supplier=null;response=await get();assert.equal(response.status,404);assert.equal(requests,3);assert.equal(sessions,3);
state.supplier={sourceProductId:source,provider:'OTHER',status:'ACTIVE'};assert.equal((await get()).status,422);assert.equal(requests,3);
const auth=load('src/lib/manager-admin-auth.ts');assert.equal(auth.isPublicManagerPath('/api/products/product/suppliers/supplier/official-preview'),false);
console.log('PASS: direct/wrapped media, exact native properties, identity failure, no writes/fallback/credential renewal, masked failures, admin proxy');
