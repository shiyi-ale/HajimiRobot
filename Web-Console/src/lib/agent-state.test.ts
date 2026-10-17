import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeAgentSession} from './agent-state';
test('session restores pending report with its original source and date',()=>{
  const context={date:'2026-10-17',camera:'secondary',source:'test'};
  const id='11111111-1111-4111-8111-111111111111';
  const state=decodeAgentSession(JSON.stringify({context,pending:{id,context}}),'2026-10-18');
  assert.equal(state.pending?.id,id);assert.equal(state.context.date,'2026-10-17');assert.equal(state.pending?.context.source,'test');
});
test('invalid sessions fall back safely and extra secret fields are discarded',()=>{
  assert.equal(decodeAgentSession('{broken','2026-10-18').context.date,'2026-10-18');
  const result=decodeAgentSession(JSON.stringify({context:{date:'2026-10-17',camera:'primary',source:'test',api_key:'fixture-private-value'},pending:{id:'../../settings'}}),'2026-10-18');
  assert.equal(result.pending,undefined);assert.ok(!JSON.stringify(result).includes('fixture-private-value'));
});
