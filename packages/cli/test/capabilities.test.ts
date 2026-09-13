import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatAPIClient } from 'beatapi-client';
import { run } from '../src/cli.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI discovery needs no key and preserves partial Inspect output with a warning', async()=>{
  let output='',warning='';
  const client=new BeatAPIClient({fetch:async()=>Response.json({data:{reference:'model:fixture',validation:{state:'partial'}}})});
  const code=await run(['capabilities','inspect','model:fixture'],{env:{},createClient:()=>client,stdout:t=>output+=t,stderr:t=>warning+=t,credentialStore:{get:async()=>{throw Error('Must not access keychain');},set:async()=>{},delete:async()=>{}}});
  assert.equal(code,0);
  assert.equal(JSON.parse(output).validation.state,'partial');
  assert.match(warning,/partial/i);
});

test('CLI runs explicit input once, saves sync data, and rejects misspelled flags before execution', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'beatapi-cli-test-'));
  try {
    const file=join(dir,'input.json'),output=join(dir,'output.json');
    await writeFile(file,JSON.stringify({keyword:'AI'}));
    let calls=0,stdout='';
    const client=new BeatAPIClient({apiKey:'sk_fixture_secret',fetch:async(url,init)=>{
      calls++;
      assert.ok(String(url).endsWith('/v1/capabilities/run'));
      assert.equal(init?.redirect,'error');
      assert.deepEqual(JSON.parse(String(init?.body)),{reference:'data:fixture',operation:'start',input:{keyword:'AI'},idempotency_key:'repeat-me'});
      return Response.json({data:{posts:[]}});
    }});
    const options={apiKey:'sk_fixture_secret',createClient:()=>client,stdout:(t:string)=>stdout+=t,stderr:()=>{}};
    assert.equal(await run(['capabilities','run','data:fixture','--file',file,'--idempotency-key','repeat-me','--output',output],options),0);
    assert.equal(calls,1);
    assert.deepEqual(JSON.parse(await readFile(output,'utf8')),{posts:[]});
    await assert.rejects(run(['capabilities','run','data:fixture','--file',file,'--idem','typo'],options),/Unknown/);
    assert.equal(calls,1);
    assert.ok(!stdout.includes('sk_fixture_secret'));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('bounded status polling never starts a task and stops for manual actions or unknown states', async()=>{
  for(const status of ['queued','requires_action','failed','unexpected']) {
    let calls=0,output='';
    const client=new BeatAPIClient({apiKey:'sk_fixture',fetch:async(url,init)=>{
      calls++;assert.ok(String(url).endsWith('/v1/capabilities/run'));
      assert.deepEqual(JSON.parse(String(init?.body)),{reference:'workflow:fixture',operation:'status',task_id:'task_fixture'});
      return Response.json({data:{id:'task_fixture',status}});
    }});
    const code=await run(['capabilities','status','workflow:fixture','task_fixture','--wait','--attempts','1'],{apiKey:'sk_fixture',createClient:()=>client,stdout:t=>output+=t,stderr:()=>{}});
    assert.equal(calls,1);assert.equal(JSON.parse(output).status,status);
    assert.equal(code,status==='requires_action'?0:1);
  }
});
