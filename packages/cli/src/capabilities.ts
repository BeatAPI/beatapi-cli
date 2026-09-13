import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { BeatAPIClient, type CapabilityKind } from 'beatapi-client';

export type CapabilityClient = Pick<BeatAPIClient, 'searchCapabilities'|'inspectCapability'|'runCapability'|'getCapabilityStatus'>;
export async function runCapabilities(args: string[], client: CapabilityClient, stdout: (s:string)=>void, stderr:(s:string)=>void): Promise<number> {
  const [action, ...rest] = args;
  const allowed: Record<string,string[]> = {
    search:['--query','--kind','--platform','--limit','--cursor','--output'],
    inspect:['--output'], run:['--file','--idempotency-key','--output'],
    status:['--wait','--interval','--attempts','--output'],
  };
  if(!action || !allowed[action]) throw Error('Use capabilities search, inspect, run or status.');
  const flags=new Map<string,string>(); const positional:string[]=[];
  for(let i=0;i<rest.length;i++) {
    const token=rest[i]!;
    if(!token.startsWith('--')) {positional.push(token);continue;}
    if(!allowed[action]!.includes(token) || flags.has(token)) throw Error('Unknown or duplicate option: '+token);
    if(token==='--wait'){flags.set(token,'true');continue;}
    const value=rest[++i]; if(!value || value.startsWith('--')) throw Error('Missing value for '+token);
    flags.set(token,value);
  }
  const expected=action==='search'?0:action==='status'?2:1;
  if(positional.length!==expected) throw Error('Expected '+expected+' positional argument(s) for '+action+'.');
  const emit=async(value:unknown)=>{
    const text=JSON.stringify(value,null,2)+'\n';
    const path=flags.get('--output');
    stdout(text);
    if(path) await writeFile(path,text,{flag:'wx',mode:0o600});
  };
  if(action==='search') {
    const kind=flags.get('--kind');
    if(kind && !['model','data','workflow'].includes(kind)) throw Error('kind must be model, data or workflow.');
    await emit(await client.searchCapabilities({
      ...(kind?{kind:kind as CapabilityKind}:{}),
      ...(flags.has('--query')?{query:flags.get('--query')!}:{}),
      ...(flags.has('--platform')?{platform:flags.get('--platform')!}:{}),
      ...(flags.has('--cursor')?{cursor:flags.get('--cursor')!}:{}),
      ...(flags.has('--limit')?{limit:Number(flags.get('--limit'))}:{}),
    })); return 0;
  }
  if(action==='inspect') {
    const contract=await client.inspectCapability(positional[0]!);
    if(contract.validation?.state!=='verified') stderr('Inspect contract is '+(contract.validation?.state??'unknown')+'; consult official API documentation for missing parameters before running.\n');
    await emit(contract);return 0;
  }
  if(action==='run') {
    const file=flags.get('--file');if(!file) throw Error('--file <input.json> is required.');
    const input: unknown=JSON.parse(await readFile(file,'utf8'));
    if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('Input file must contain a JSON object, not a Run envelope.');
    const key=flags.get('--idempotency-key')??randomUUID();
    stderr('Idempotency key: '+key+' — reuse it and the same input if retrying this task.\n');
    await emit(await client.runCapability(positional[0]!,input as Record<string,unknown>,{idempotencyKey:key}));return 0;
  }
  const waiting=flags.has('--wait');
  const attempts=Number(flags.get('--attempts')??120), interval=Number(flags.get('--interval')??5000);
  if(!Number.isInteger(attempts)||attempts<1||attempts>1200||!Number.isInteger(interval)||interval<1000||interval>60000) throw Error('attempts must be 1-1200; interval must be 1000-60000 milliseconds.');
  if(!waiting && (flags.has('--attempts')||flags.has('--interval'))) throw Error('--attempts and --interval require --wait.');
  let result: Record<string,unknown>={};
  for(let i=0;i<(waiting?attempts:1);i++) {
    result=await client.getCapabilityStatus(positional[0]!,positional[1]!);
    if(!waiting || !['queued','processing'].includes(String(result.status))) {
      await emit(result);
      if(result.status==='failed')return 1;
      if(waiting && !['succeeded','requires_action','storyboard_ready'].includes(String(result.status))) {stderr('Unknown task state; stopped polling.\n');return 1;}
      return 0;
    }
    stderr('Task '+positional[1]+': '+String(result.status)+'\n');
    if(i+1<attempts) await new Promise(resolve=>setTimeout(resolve,interval));
  }
  await emit(result);stderr('Wait limit reached; resume status lookup with the same task ID. Do not restart.\n');return 1;
}
