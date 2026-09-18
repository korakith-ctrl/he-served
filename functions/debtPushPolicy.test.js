const {test} = require('node:test');
const assert = require('node:assert/strict');
const {localClock,quiet,reminders,timeValid} = require('./debtPushPolicy');
const debt = {status:'active',debtorUid:'debtor',outstandingAmount:300,installments:{a:{sequence:1,amount:100,paidAmount:0,dueDate:'2026-09-09'},b:{sequence:2,amount:200,paidAmount:0,dueDate:'2026-09-09'}}};
test('Bangkok date rolls over at 17:00 UTC', () => {
  assert.deepEqual(localClock(Date.parse('2026-09-06T17:00:00Z')),{date:'2026-09-07',time:'00:00'});
});
test('quiet hours cover midnight with exclusive end and may be disabled', () => {
  assert.equal(quiet({},'21:00'),true); assert.equal(quiet({},'07:59'),true); assert.equal(quiet({},'08:00'),false);
  assert.equal(quiet({quietStart:'12:00',quietEnd:'13:00'},'12:30'),true);
  assert.equal(quiet({quietStart:'00:00',quietEnd:'00:00'},'00:00'),false);
});
test('only three reminder stages and valid outstanding debts', () => {
  assert.equal(reminders(debt,{},'2026-09-06').length,2);
  assert.equal(reminders(debt,{},'2026-09-09')[0].stage,'0');
  assert.equal(reminders(debt,{},'2026-09-10')[0].stage,'-1');
  assert.equal(reminders(debt,{},'2026-09-11').length,0);
  for (const status of ['pending','cancelled','paid']) assert.equal(reminders({...debt,status},{},'2026-09-06').length,0);
  assert.equal(reminders({status:'active',debtorUid:'d',outstandingAmount:10},{},'2026-09-06').length,0);
});
test('pending targeted payments only suppress their installment', () => {
  const rows = reminders(debt,{p:{status:'pending',amount:100,targetInstallmentId:'b'}},'2026-09-06');
  assert.deepEqual(rows.map(x=>x.remaining),[100,100]);
});
test('unallocated pending payments suppress oldest installments first', () => {
  const rows = reminders(debt,{p:{status:'pending',amount:150}},'2026-09-06');
  assert.equal(rows.length,1); assert.equal(rows[0].installmentId,'b'); assert.equal(rows[0].remaining,150);
});
test('confirmed payments are already in paidAmount; rejected payments do not suppress', () => {
  const d = {...debt,installments:{a:{...debt.installments.a,paidAmount:40}}};
  assert.equal(reminders(d,{p:{status:'confirmed',amount:40},q:{status:'rejected',amount:60}},'2026-09-06')[0].remaining,60);
});
test('changed due date and paid installments stop obsolete reminders', () => {
  assert.equal(reminders({...debt,installments:{a:{...debt.installments.a,dueDate:'2026-09-20'}}},{},'2026-09-06').length,0);
  assert.equal(reminders({...debt,outstandingAmount:0},{},'2026-09-06').length,0);
});
test('time preference rejects impossible values', () => {
  for (const value of ['24:00','09:60','9:00',null]) assert.equal(timeValid(value),false);
  assert.equal(timeValid('23:59'),true);
});
