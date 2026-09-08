import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { createClaim } from '../../evidence/src/claim-repo.ts';
import { createClaimArgument } from '../../evidence/src/claim-argument-repo.ts';
import { createClaimEvidence } from '../../evidence/src/claim-evidence-repo.ts';
import { createDocument } from '../../evidence/src/document-repo.ts';
import { createSource } from '../../evidence/src/source-repo.ts';
import { ephemeralRawBlobIdForSource } from '../../evidence/src/object-store.ts';
import type { ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable, registerLifoCleanup } from '../../../db/test/docker-pg.ts';
import { createAgent, getAgent } from '../../agents/src/agent-repo.ts';
import { saveThesis, loadThesisHistory } from '../../agents/src/thesis-repo.ts';
import { runAgentLoop } from '../../agents/src/agent-loop.ts';
import { createThesisAgentLoopStages } from '../src/thesis-runtime.ts';
import { createThesisAdapter } from '../src/thesis-adapter.ts';
import { createDevApiServer, createServiceDevApiAdapters } from '../src/http.ts';
import { createAgentLoopStages, closeLocalRuntimePoolForTests } from '../src/local-runtime.ts';
import type { AddressInfo } from 'node:net';
import { loadEvidenceInspection } from '../../evidence/src/inspector.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000099';
const ISSUER = '20000000-0000-4000-8000-000000000001';
const CONDITION = '30000000-0000-4000-8000-000000000001';

test('thesis monitoring persists, deduplicates, reassesses changed facts and protects history', { skip: !dockerAvailable(), timeout: 120000 }, async t => {
  const { databaseUrl } = await bootstrapDatabase(t, 'living-thesis-runtime');
  const db = await connectedClient(t, databaseUrl);
  const pool = await connectedPool(t, databaseUrl);
  await db.query('insert into users(user_id,email) values($1,$2),($3,$4)', [USER,'thesis@example.test',OTHER,'other@example.test']);
  await db.query("insert into issuers(issuer_id,legal_name) values($1,'Test issuer')", [ISSUER]);
  const agent = await createAgent(db, { user_id: USER, name: 'Cash monitor', thesis: 'Cash reserves remain strong.', cadence:'daily', universe:{mode:'static',subject_refs:[{kind:'issuer',id:ISSUER}]} });
  const source = randomUUID();
  const metric = {metric_id:randomUUID(),metric_key:'cash_reserves'};
  await db.query("insert into sources(source_id,provider,kind,trust_tier,license_class,retrieved_at) values($1,'Test filings','filing','primary','public',now())",[source]);
  await db.query("insert into metrics(metric_id,metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class) values($1,$2,'Cash reserves','currency','latest','higher is better','filing')",[metric.metric_id,metric.metric_key]);
  const conditions = [{condition_id:CONDITION,statement:'Cash reserves remain strong.',falsifier:'Cash reserves fall below the required floor.',horizon:'Next quarter',metric:{metric_key:metric.metric_key,unit:'USD',period_kind:'point' as const,operator:'gte' as const,threshold:1_000_000,max_age_days:90}}];
  let thesis = await saveThesis(db, { agent_id:agent.agent_id,user_id:USER,expected_version:0,thesis:agent.thesis,subject_ref:{kind:'issuer',id:ISSUER},conditions });
  const adapter = createThesisAdapter(db);
  await assert.rejects(adapter.get({userId:OTHER,agentId:agent.agent_id}), {status:404});
  await assert.rejects(adapter.save({userId:OTHER,agentId:agent.agent_id,body:{expected_version:1,thesis:'Stolen thesis',conditions}}), {status:404});
  const insertFact = async (value:number, scale=1) => {
    const id = randomUUID();
    await db.query(`insert into facts(fact_id,subject_kind,subject_id,metric_id,period_kind,period_end,value_num,unit,scale,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence)
      values($1,'issuer',$2,$3,'point',current_date,$4,'USD',$5,now(),now(),$6,'reported','authoritative','filing_time','full',1)`, [id,ISSUER,metric.metric_id,value,scale,source]);
    return id;
  };
  const fact1 = await insertFact(2,1_000_000);
  const configured = await adapter.get({userId:USER,agentId:agent.agent_id});
  assert.deepEqual(configured.metrics,[{metric_key:metric.metric_key,label:'Cash reserves',unit:'USD',period_kind:'point'}]);
  await assert.rejects(adapter.save({userId:USER,agentId:agent.agent_id,body:{expected_version:0,thesis:agent.thesis,conditions}}),{status:409});
  await assert.rejects(adapter.save({userId:USER,agentId:agent.agent_id,body:{expected_version:1,thesis:agent.thesis,conditions:[]}}),{status:400});
  const noModelAdapter=createThesisAdapter(db,async()=>null);
  await assert.rejects(noModelAdapter.draft({userId:USER,agentId:agent.agent_id,body:{thesis:agent.thesis}}),{status:503});
  const services=createServiceDevApiAdapters({db:pool,async sealAnalyzeSnapshot(){throw new Error('not used');}});
  const renamed=await services.agents.update({userId:USER,agentId:agent.agent_id,body:{name:'Cash thesis monitor'}});
  assert.equal(renamed?.name,'Cash thesis monitor');
  await assert.rejects(services.agents.update({userId:USER,agentId:agent.agent_id,body:{thesis:'An unversioned replacement thesis.'}}),{status:409});
  await assert.rejects(services.agents.update({userId:USER,agentId:agent.agent_id,body:{universe:{mode:'static',subject_refs:[{kind:'issuer',id:randomUUID()}]}}}),{status:409});
  // A dense history in another unit must not crowd out the requested USD fact.
  await db.query(`insert into facts(subject_kind,subject_id,metric_id,period_kind,period_end,value_num,unit,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence)
    select subject_kind,subject_id,metric_id,period_kind,period_end,value_num,'EUR',now(),now(),source_id,method,verification_status,freshness_class,coverage_level,confidence
    from facts cross join generate_series(1,260) where fact_id=$1`,[fact1]);
  async function execute(beforePersist?:()=>Promise<void>) {
    const freshAgent = (await getAgent(db, agent.agent_id))!;
    const stages = createThesisAgentLoopStages({db:pool,userId:USER,runId:randomUUID(),agent:freshAgent,thesis});
    if (beforePersist) {
      const analyze = stages.analyze;
      stages.analyze = async input => { const result = await analyze(input); await beforePersist(); return result; };
    }
    return runAgentLoop({pool,agent_id:agent.agent_id,current_watermarks:freshAgent.watermarks,stages});
  }
  await Promise.all([execute(),execute()]);
  let history = await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments.length,1);
  assert.equal(history.assessments[0].results[0].status,'supported');
  assert.deepEqual(history.assessments[0].results[0].fact_refs,[fact1]);
  const firstSnapshot = history.assessments[0].snapshot_id;
  const inspected = await loadEvidenceInspection(db,{user_id:USER,snapshot_id:firstSnapshot,ref:{kind:'fact',id:fact1}});
  assert.equal(inspected.ref.id,fact1);
  assert.equal(inspected.title,'2000000 USD');
  assert.deepEqual(inspected.rows.find(row=>row.label==='Value'),{label:'Value',value:'2000000'});
  await assert.rejects(loadEvidenceInspection(db,{user_id:OTHER,snapshot_id:firstSnapshot,ref:{kind:'fact',id:fact1}}),{status:404});
  await execute();
  assert.equal((await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER})).assessments.length,1);
  assert.equal((await db.query('select count(*)::int as n from findings where agent_id=$1',[agent.agent_id])).rows[0].n,1);
  await db.query('update facts set invalidated_at=now() where fact_id=$1',[fact1]);
  const fact2=await insertFact(0.8,1_000_000);
  await execute();
  history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments[0].results[0].status,'challenged');
  assert.deepEqual(history.assessments[0].results[0].fact_refs,[fact2]);
  assert.equal((await db.query('select count(*)::int as n from findings where agent_id=$1',[agent.agent_id])).rows[0].n,2);
  await db.query('update facts set invalidated_at=now() where fact_id=$1',[fact2]);
  await execute();
  history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments[0].results[0].status,'unresolved');
  assert.equal((await db.query('select count(*)::int as n from findings where agent_id=$1',[agent.agent_id])).rows[0].n,2);
  await db.query('update facts set invalidated_at=null where fact_id=$1',[fact1]);
  await execute();
  history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments[0].results[0].status,'supported', 'recurring earlier evidence must become current again');
  assert.equal(history.assessments.length,4);
  const priorCount=history.assessments.length;
  await assert.rejects(execute(async () => {
    thesis=await saveThesis(db,{agent_id:agent.agent_id,user_id:USER,expected_version:1,thesis:'Cash reserves recover sustainably.',subject_ref:{kind:'issuer',id:ISSUER},conditions});
  }),/changed|version/i);
  history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.versions.length,2);
  assert.equal(history.assessments.length,priorCount);
  // Exercise the actual HTTP run path and stage selector with alert persistence.
  const previousUrl=process.env.DATABASE_URL;
  process.env.DATABASE_URL=databaseUrl;
  registerLifoCleanup(t,async()=>{await closeLocalRuntimePoolForTests(); if(previousUrl===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=previousUrl;});
  const realAdapters=createServiceDevApiAdapters({db:pool,createAgentLoopStages,async sealAnalyzeSnapshot(){throw new Error('not used');}});
  await realAdapters.agents.update({userId:USER,agentId:agent.agent_id,body:{alert_rules:[{rule_id:'thesis-transition',severity_at_least:'medium',channels:['email']}]}});
  const server=createDevApiServer({}, {adapters:realAdapters});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  registerLifoCleanup(t,()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/agents/${agent.agent_id}/runs`;
  for(let i=0;i<2;i++) {
    const response=await fetch(url,{method:'POST',headers:{'x-user-id':USER}});
    assert.equal(response.status,201);
    const run=await response.json() as {status:string};
    assert.equal(run.status,'completed');
    assert.equal((await db.query('select count(*)::int as n from alerts_fired where agent_id=$1',[agent.agent_id])).rows[0].n,1);
  }
  assert.equal((await db.query('select count(*)::int as n from alerts_fired where agent_id=$1',[agent.agent_id])).rows[0].n,1);
});


test('narrative monitoring includes IR and non-IR claims, rejects fabricated citations and handles removed evidence', {skip:!dockerAvailable(),timeout:120000}, async t => {
  const {databaseUrl}=await bootstrapDatabase(t,'living-thesis-narrative');
  const db=await connectedClient(t,databaseUrl);
  const pool=await connectedPool(t,databaseUrl);
  await db.query('insert into users(user_id,email) values($1,$2),($3,$4)',[USER,'narrative@example.test',OTHER,'foreign@example.test']);
  await db.query("insert into issuers(issuer_id,legal_name) values($1,'Narrative issuer')",[ISSUER]);
  const agent=await createAgent(db,{user_id:USER,name:'Demand monitor',thesis:'Demand remains durable throughout the year.',cadence:'daily',universe:{mode:'static',subject_refs:[{kind:'issuer',id:ISSUER}]}});
  const thesis=await saveThesis(db,{agent_id:agent.agent_id,user_id:USER,expected_version:0,thesis:agent.thesis,subject_ref:{kind:'issuer',id:ISSUER},conditions:[{condition_id:CONDITION,statement:'Demand remains durable throughout the year.',falsifier:'Customers cancel orders and demand contracts.',horizon:'This year'}]});
  async function evidence(label:string,owner:string|null=USER,published=new Date(Date.now()-86400000).toISOString()) {
    const source=await createSource(db,{provider:label,kind:'filing',trust_tier:'primary',license_class:'public',retrieved_at:published,user_id:owner});
    const document=(await createDocument(db,{source_id:source.source_id,kind:'filing',title:label,published_at:published,content_hash:'sha256:'+createHash('sha256').update(label).digest('hex'),raw_blob_id:ephemeralRawBlobIdForSource(source.source_id),parse_status:'parsed'})).document;
    const claim=await createClaim(db,{document_id:document.document_id,predicate:'demand.change',text_canonical:label+' customers canceled their orders.',polarity:'negative',modality:'asserted',reported_by_source_id:source.source_id,effective_time:published,confidence:0.9,status:'extracted'});
    await createClaimArgument(db,{claim_id:claim.claim_id,subject_kind:'issuer',subject_id:ISSUER,role:'subject'});
    await createClaimEvidence(db,{claim_id:claim.claim_id,document_id:document.document_id,locator:{kind:'paragraph',index:1},confidence:0.9});
    return {source,document,claim};
  }
  const valid=await evidence('Current');
  await db.query(`insert into entity_impacts(claim_id,subject_kind,subject_id,direction,channel,horizon,confidence)
    values($1,'issuer',$2,'negative','demand','near_term',0.9)`,[valid.claim.claim_id,ISSUER]);
  const ir=await evidence('Issuer IR');
  const irRegistry=await db.query<{ir_source_id:string}>(`insert into ir_source_registry(issuer_id,source_type,url,enabled)
    values($1,'rss','https://investors.example.test/news/rss',true) returning ir_source_id::text as ir_source_id`,[ISSUER]);
  await db.query(`insert into ir_document_assets(ir_source_id,issuer_id,document_id,source_id,asset_kind,canonical_url,hosted_provider,issuer_attested,content_type,discovered_at,fetched_at)
    values($1,$2,$3,$4,'press_release','https://investors.example.test/news/current','issuer_ir',true,'text/html',now(),now())`,
    [irRegistry.rows[0]!.ir_source_id,ISSUER,ir.document.document_id,ir.source.source_id]);
  const foreign=await evidence('Foreign',OTHER);
  const deleted=await evidence('Deleted');
  await db.query('update documents set deleted_at=now() where document_id=$1',[deleted.document.document_id]);
  const old=await evidence('Superseded');
  await db.query('update claims set superseded_at=now() where claim_id=$1',[old.claim.claim_id]);
  // These invalid rows must be filtered before the packet's 100-claim bound.
  const future=await evidence('Future',null,new Date(Date.now()+86400000).toISOString());
  await db.query(`with copies as (
    insert into claims(document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,effective_time,confidence,status)
    select document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,effective_time,confidence,status
    from claims cross join generate_series(1,100) where claim_id=$1 returning claim_id)
    insert into claim_arguments(claim_id,subject_kind,subject_id,role) select claim_id,'issuer',$2,'subject' from copies`,[future.claim.claim_id,ISSUER]);
  let calls=0;
  const model:ThesisLlm={async complete(input){
    calls++;
    const packet=JSON.parse(input.messages[1].content);
    assert.deepEqual(packet.claims.map((c:{claim_id:string})=>c.claim_id).sort(),[valid.claim.claim_id,ir.claim.claim_id].sort());
    return {text:JSON.stringify({results:[{condition_id:CONDITION,status:'challenged',reason:'The cited cancellations challenge demand durability.',claim_refs:[valid.claim.claim_id]}]}),deployment:{channel:'test',model:'controlled'}};
  }};
  async function execute(llm:ThesisLlm|null=model,identity='controlled') {
    const fresh=(await getAgent(db,agent.agent_id))!;
    const stages=createThesisAgentLoopStages({db:pool,userId:USER,runId:randomUUID(),agent:fresh,thesis,getModel:async()=>({llm,identity})});
    return runAgentLoop({pool,agent_id:agent.agent_id,current_watermarks:fresh.watermarks,stages});
  }
  await execute();
  await execute();
  assert.equal(calls,1);
  let history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments[0].model_version,'test:controlled');
  assert.equal(history.assessments[0].results[0].status,'challenged');
  assert.equal((await db.query('select severity from findings where agent_id=$1',[agent.agent_id])).rows[0].severity,'critical','direct relevance plus strong sourced impact must use existing severity policy');
  const inspection=await loadEvidenceInspection(db,{user_id:USER,snapshot_id:history.assessments[0].snapshot_id,ref:{kind:'claim',id:valid.claim.claim_id}});
  assert.equal(inspection.ref.id,valid.claim.claim_id);
  await assert.rejects(loadEvidenceInspection(db,{user_id:OTHER,snapshot_id:history.assessments[0].snapshot_id,ref:{kind:'claim',id:valid.claim.claim_id}}),{status:404});
  const assessedSnapshot=history.assessments[0].snapshot_id;
  const inspectCurrent=()=>loadEvidenceInspection(db,{user_id:USER,snapshot_id:assessedSnapshot,ref:{kind:'claim' as const,id:valid.claim.claim_id}});
  await db.query('update documents set deleted_at=now() where document_id=$1',[valid.document.document_id]);
  await assert.rejects(inspectCurrent(),{status:404});
  await db.query('update documents set deleted_at=null where document_id=$1',[valid.document.document_id]);
  await db.query('update documents set source_id=$1 where document_id=$2',[foreign.source.source_id,valid.document.document_id]);
  await assert.rejects(inspectCurrent(),{status:404});
  await db.query('update documents set source_id=$1 where document_id=$2',[valid.source.source_id,valid.document.document_id]);
  const watermarks=(await getAgent(db,agent.agent_id))!.watermarks;
  await assert.rejects(execute(null,'unavailable'),/unavailable/);
  await assert.rejects(execute({async complete(){return {text:JSON.stringify({results:[{condition_id:CONDITION,status:'supported',reason:'Fabricated evidence.',claim_refs:[randomUUID()]}]})};}},'invalid'),/unsupplied/);
  assert.deepEqual((await getAgent(db,agent.agent_id))!.watermarks,watermarks);
  assert.equal((await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER})).assessments.length,1);
  await db.query('update claims set superseded_at=now() where claim_id=any($1::uuid[])',[[valid.claim.claim_id,ir.claim.claim_id]]);
  assert.equal((await inspectCurrent()).ref.id,valid.claim.claim_id,'accessible superseded claims remain inspectable in their historical snapshot');
  await execute(null);
  history=await loadThesisHistory(db,{agent_id:agent.agent_id,user_id:USER});
  assert.equal(history.assessments[0].results[0].status,'unresolved');
  assert.equal((await db.query('select count(*)::int as n from findings where agent_id=$1',[agent.agent_id])).rows[0].n,1);
});
