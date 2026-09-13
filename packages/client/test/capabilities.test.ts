import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatAPIClient } from '../src/client.js';

test('capability discovery preserves the page envelope and inspects the returned reference', async () => {
  const client = new BeatAPIClient({ fetch: async (url, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/search')) {
      assert.deepEqual(body, {kind:'model',query:'image',limit:1});
      return Response.json({data:{data:[{reference:'model:fixture'}],next_cursor:'next'}});
    }
    assert.deepEqual(body, {reference:'model:fixture'});
    return Response.json({data:{reference:body.reference,validation:{state:'partial'}}});
  }});
  const page = await client.searchCapabilities({kind:'model',query:'image',limit:1});
  assert.equal(page.next_cursor, 'next');
  const contract = await client.inspectCapability(page.data[0]!.reference);
  assert.equal(contract.validation?.state, 'partial');
});

test('start retries retain one idempotency key; status uses the same Run endpoint', async () => {
  let starts = 0;
  const client = new BeatAPIClient({apiKey:'sk_test_secret', sleep:async()=>{}, fetch:async(url,init)=>{
    assert.ok(String(url).endsWith('/v1/capabilities/run'));
    const body = JSON.parse(String(init?.body));
    if(body.operation === 'start') {
      assert.equal(body.idempotency_key, 'same-request');
      assert.equal(new Headers(init?.headers).get('idempotency-key'),'same-request');
      assert.deepEqual(body.input,{prompt:'test'});
      if(++starts === 1) return Response.json({error:{message:'busy'}},{status:503});
      return Response.json({data:{id:'task_fixture',status:'queued'}});
    }
    assert.equal(body.task_id,'task_fixture');
    return Response.json({data:{id:body.task_id,status:'succeeded',output:{media:[]}}});
  }});
  const result = await client.runCapability('model:fixture',{prompt:'test'},{idempotencyKey:'same-request',retry:{maxAttempts:2}});
  assert.equal(result.id,'task_fixture');
  assert.equal((await client.getCapabilityStatus('model:fixture',String(result.id))).status,'succeeded');
  assert.equal(starts,2);
  assert.throws(()=>client.runCapability('model:fixture',{}, {idempotencyKey:''}),/idempotency/);
});

test('authentication errors retain their request ID and never retry a start by default', async()=>{
  let calls=0;
  const client=new BeatAPIClient({apiKey:'sk_fixture',fetch:async()=>{
    calls++;return Response.json({error:{code:'unauthorized',message:'Invalid key',request_id:'req_fixture'}},{status:401});
  }});
  await assert.rejects(client.runCapability('model:fixture',{}, {idempotencyKey:'once'}), (e:unknown)=>{
    const error=e as {status:number;requestId:string};
    return error.status===401 && error.requestId==='req_fixture';
  });
  assert.equal(calls,1);
});
